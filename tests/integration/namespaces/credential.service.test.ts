/**
 * @module integrations/tests/credential-service
 * @summary End-to-end coverage for the namespaced Credential model/service on RAM.
 * @description Creates a Tenant first (required relation), then drives the
 * credential lifecycle through {@link CredentialService} while asserting the
 * referenced model-backed secret is encrypted at rest and hard-deleted with
 * the credential row.
 */
import { jest } from "@jest/globals";
import { Adapter, Context, Repository } from "@decaf-ts/core";
import { RamAdapter, RamFlavour } from "@decaf-ts/core/ram";
import { Model } from "@decaf-ts/decorator-validation";
import { NotFoundError } from "@decaf-ts/db-decorators";
import { Logging } from "@decaf-ts/logging";
import { CredentialService } from "../../../src/namespaces/services/credential.service";
import { Credential } from "../../../src/namespaces/models/credential.model";
import { Tenant } from "../../../src/namespaces/models/tenant.model";
import { IsolationTier, CredentialProvider } from "../../../src/namespaces/types";
import { ModelSecretService } from "../../../src/secrets/model/ModelSecretService";
import { Secret } from "../../../src/secrets/model/Secret";

RamAdapter.decoration();
Adapter.setCurrent(RamFlavour);
Model.setBuilder(Model.fromModel);

describe("CredentialService (RAM)", () => {
  let ram: RamAdapter;
  let tenant: Tenant;
  let credentialRepository: Repository<Credential, any>;
  let secretRepository: Repository<Secret, any>;
  let secretService: ModelSecretService;
  let service: CredentialService;

  beforeAll(async () => {
    ram = new RamAdapter();
    await ram.initialize();

    const tenantRepository = Repository.forModel<Tenant, Repository<Tenant, any>>(
      Tenant
    );
    tenant = await tenantRepository.create(
      new Tenant({
        slug: "credential-test-tenant",
        name: "Credential Test Tenant",
        isolationTier: IsolationTier.Pooled,
      })
    );

    credentialRepository = Repository.forModel<
      Credential,
      Repository<Credential, any>
    >(Credential);
    secretRepository = Repository.forModel<Secret, Repository<Secret, any>>(
      Secret
    );
    secretService = new ModelSecretService();
    await secretService.boot(
      { provider: "model", keySecret: "credential-test-key", keyId: "k1" },
      secretRepository
    );
    service = new CredentialService({
      secretService,
      repository: credentialRepository,
    });
  });

  afterAll(async () => {
    await ram.shutdown();
  });

  async function secretRowsFor(secretName: string): Promise<Secret[]> {
    return secretRepository
      .select()
      .execute()
      .then((rows: Secret[]) => rows.filter((row) => row.name === secretName));
  }

  it("creates a credential row and an encrypted secret", async () => {
    const created = await service.createCredential({
      tenantId: tenant.id,
      name: "database-password",
      credentialType: "password",
      secret: "plaintext-database-password",
      description: "primary database",
      metadata: { environment: "test" },
    });

    expect(created).toBeInstanceOf(Credential);
    expect(created).toMatchObject({
      name: "database-password",
      credentialType: "password",
      provider: CredentialProvider.Model,
      description: "primary database",
      metadata: { environment: "test" },
      enabled: true,
    });
    expect(created.tenant).toBe(tenant.id);
    expect(created.secretName).toMatch(/^credential-[0-9a-f-]{36}$/);

    const rows = await secretRowsFor(created.secretName);
    expect(rows).toHaveLength(1);
    expect(rows[0].encryptedPayload).not.toContain(
      "plaintext-database-password"
    );
    expect(rows[0].encryption.salt).toBeTruthy();

    await expect(
      secretService.retrieve(created.secretName)
    ).resolves.toBe("plaintext-database-password");
  });

  it("reads the persisted credential row", async () => {
    const created = await service.createCredential({
      tenantId: tenant.id,
      name: "api-token",
      credentialType: "token",
      secret: "api-token-value",
    });

    const read = await service.getCredential(created.id);

    expect(read).toBeInstanceOf(Credential);
    expect(read).toMatchObject({
      id: created.id,
      name: "api-token",
      secretName: created.secretName,
    });
  });

  it("lists summaries without exposing secret values", async () => {
    const created = await service.createCredential({
      tenantId: tenant.id,
      name: "summary-credential",
      credentialType: "password",
      secret: "summary-secret-value",
      metadata: { label: "summary" },
    });

    const summaries = await service.listCredentials();
    const summary = summaries.find((item) => item.id === created.id);

    expect(summary).toMatchObject({
      id: created.id,
      tenantId: tenant.id,
      name: "summary-credential",
      provider: CredentialProvider.Model,
      metadata: { label: "summary" },
    });
    expect(summary).not.toHaveProperty("secretName");
    expect(summary).not.toHaveProperty("secret");
    expect(JSON.stringify(summaries)).not.toContain("summary-secret-value");
  });

  it("rotates the referenced secret and retains the row", async () => {
    const created = await service.createCredential({
      tenantId: tenant.id,
      name: "rotating-credential",
      credentialType: "password",
      secret: "rotating-secret-v1",
    });

    const rotated = await service.rotateCredential({
      credentialId: created.id,
      secret: "rotating-secret-v2",
      version: "v2",
    });

    expect(rotated.id).toBe(created.id);
    expect(rotated.updatedAt).toBeInstanceOf(Date);
    await expect(
      secretService.retrieve(created.secretName, { version: "v2" })
    ).resolves.toBe("rotating-secret-v2");
    await expect(
      secretService.retrieve(created.secretName, { version: "v1" })
    ).rejects.toBeInstanceOf(NotFoundError);

    const rows = await secretRowsFor(created.secretName);
    expect(rows).toHaveLength(1);
    expect(rows[0].version).toBe("v2");
    expect(rows[0].encryptedPayload).not.toContain("rotating-secret-v2");
  });

  it("marks the credential as used", async () => {
    const created = await service.createCredential({
      tenantId: tenant.id,
      name: "used-credential",
      credentialType: "password",
      secret: "used-secret",
    });

    const used = await service.markCredentialUsed(created.id);

    expect(used.lastUsedAt).toBeInstanceOf(Date);
    const read = await service.getCredential(created.id);
    expect(read.lastUsedAt).toBeInstanceOf(Date);
  });

  it("deletes the credential row and its secret", async () => {
    const created = await service.createCredential({
      tenantId: tenant.id,
      name: "deletable-credential",
      credentialType: "password",
      secret: "deletable-secret",
    });

    await service.deleteCredential(created.id);

    await expect(service.getCredential(created.id)).rejects.toBeInstanceOf(
      NotFoundError
    );
    await expect(secretService.exists(created.secretName)).resolves.toBe(
      false
    );
  });

  it("forwards context args to the secret store and repository", async () => {
    const storeSpy = jest.spyOn(secretService, "store");
    const createSpy = jest.spyOn(credentialRepository, "create");
    const ctx = new Context().accumulate({
      operation: "createCredential",
      logger: Logging.get(),
    });

    await service.createCredential(
      {
        tenantId: tenant.id,
        name: "context-credential",
        credentialType: "password",
        secret: "context-secret",
      },
      ctx
    );

    expect(storeSpy).toHaveBeenCalledWith(
      expect.any(String),
      "context-secret",
      {
        tenantId: tenant.id,
        orgUnitId: undefined,
        ownerPrincipalId: undefined,
      },
      expect.any(Context)
    );
    expect(createSpy).toHaveBeenCalledWith(expect.any(Object), expect.any(Context));

    storeSpy.mockRestore();
    createSpy.mockRestore();
  });
});
