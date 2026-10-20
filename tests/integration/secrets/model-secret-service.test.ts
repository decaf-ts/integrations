/**
 * @module integrations/tests/model-secret-service
 * @summary Integration coverage for {@link ModelSecretService} on RAM.
 * @description Verifies encrypted-at-rest persistence of the {@link Secret}
 * model, versioned rotation, listing/metadata, soft/hard deletion and context
 * forwarding against a real repository/adapter without external services.
 */
import { jest } from "@jest/globals";
import { Adapter, Context, Repository } from "@decaf-ts/core";
import { RamAdapter, RamFlavour } from "@decaf-ts/core/ram";
import { Model } from "@decaf-ts/decorator-validation";
import { NotFoundError } from "@decaf-ts/db-decorators";
import { Logging } from "@decaf-ts/logging";
import { ModelSecretService } from "../../../src/secrets/model/ModelSecretService";
import { Secret } from "../../../src/secrets/model/Secret";

RamAdapter.decoration();
Adapter.setCurrent(RamFlavour);
Model.setBuilder(Model.fromModel);

describe("ModelSecretService (RAM)", () => {
  let ram: RamAdapter;
  let repository: Repository<Secret, any>;
  let service: ModelSecretService;

  beforeAll(async () => {
    ram = new RamAdapter();
    await ram.initialize();
    repository = Repository.forModel<Secret, Repository<Secret, any>>(Secret);
    service = new ModelSecretService();
    await service.boot(
      { provider: "model", keySecret: "integration-test-key", keyId: "k1" },
      repository
    );
  });

  afterAll(async () => {
    await ram.shutdown();
  });

  async function secretsNamed(name: string): Promise<Secret[]> {
    return repository
      .select()
      .execute()
      .then((rows: Secret[]) => rows.filter((row) => row.name === name));
  }

  it("stores and retrieves string payloads", async () => {
    await service.store("database-password", "s3cr3t-value");

    await expect(service.retrieve("database-password")).resolves.toBe(
      "s3cr3t-value"
    );
    await expect(service.exists("database-password")).resolves.toBe(true);
  });

  it("persists an encrypted payload and the derivation salt", async () => {
    await service.store("encrypted-at-rest", "never-in-plaintext");

    const rows = await secretsNamed("encrypted-at-rest");
    expect(rows).toHaveLength(1);

    const [row] = rows;
    expect(row.encryptedPayload).toBeTruthy();
    expect(row.encryptedPayload).not.toContain("never-in-plaintext");
    expect(row.provider).toBe("model");
    expect(row.enabled).toBe(true);
    expect(row.encryption).toMatchObject({ keyId: "k1" });
    expect(row.encryption.iv).toBeTruthy();
    expect(row.encryption.salt).toBeTruthy();
    expect(row.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
    );
  });

  it("round-trips JSON object payloads", async () => {
    const payload = {
      region: "eu-west-1",
      credentials: { accessKeyId: "AKIA", secretAccessKey: "shhh" },
      retries: 5,
    };

    await service.store("object-payload", payload);
    await expect(service.retrieve("object-payload")).resolves.toEqual(payload);
  });

  it("lists stored secrets and returns metadata without exposing payloads", async () => {
    await service.store(
      "listed-secret",
      "listed-value",
      { contentType: "text/plain", tags: { team: "platform" } }
    );

    const listed = await service.list();
    const entry = listed.find((item) => item.name === "listed-secret");
    expect(entry).toMatchObject({
      provider: "model",
      name: "listed-secret",
      enabled: true,
      contentType: "text/plain",
      tags: { team: "platform" },
    });
    expect(entry?.createdAt).toBeInstanceOf(Date);
    expect(JSON.stringify(listed)).not.toContain("listed-value");

    const metadata = await service.metadata("listed-secret", {
      includeTags: true,
    });
    expect(metadata).toMatchObject({
      provider: "model",
      name: "listed-secret",
      contentType: "text/plain",
      tags: { team: "platform" },
      enabled: true,
    });
    expect(metadata).not.toHaveProperty("encryptedPayload");
  });

  it("returns undefined metadata for an unknown secret", async () => {
    await expect(service.metadata("missing-secret")).resolves.toBeUndefined();
  });

  it("rotates to a new version and retrieves that version", async () => {
    await service.store("rotating-secret", "old-value", { version: "v1" });

    const reference = await service.rotate(
      "rotating-secret",
      "new-value",
      { oldVersion: "v1", newVersion: "v2" }
    );

    expect(reference).toMatchObject({
      provider: "model",
      name: "rotating-secret",
      version: "v2",
    });
    await expect(
      service.retrieve("rotating-secret", { version: "v2" })
    ).resolves.toBe("new-value");
    await expect(
      service.retrieve("rotating-secret", { version: "v1" })
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(service.exists("rotating-secret", { version: "v2" })).resolves.toBe(
      true
    );
    await expect(service.exists("rotating-secret", { version: "v1" })).resolves.toBe(
      false
    );

    const rows = await secretsNamed("rotating-secret");
    expect(rows).toHaveLength(1);
    expect(rows[0].version).toBe("v2");
    expect(rows[0].encryption.salt).toBeTruthy();
  });

  it("soft-deletes by disabling, then hard-deletes with force", async () => {
    await service.store("deletable-secret", "delete-me");

    await service.delete("deletable-secret");
    await expect(service.exists("deletable-secret")).resolves.toBe(false);
    const disabled = await secretsNamed("deletable-secret");
    expect(disabled).toHaveLength(1);
    expect(disabled[0].enabled).toBe(false);

    await service.delete("deletable-secret", { force: true });
    await expect(secretsNamed("deletable-secret")).resolves.toHaveLength(0);
    await expect(service.retrieve("deletable-secret")).rejects.toBeInstanceOf(
      NotFoundError
    );
  });

  it("treats deleting a missing secret as a no-op", async () => {
    await expect(service.delete("never-stored")).resolves.toBeUndefined();
  });

  it("forwards context args to repository operations", async () => {
    const createSpy = jest.spyOn(repository, "create");
    const updateSpy = jest.spyOn(repository, "update");
    const storeCtx = new Context().accumulate({
      operation: "store",
      logger: Logging.get(),
    });
    const rotateCtx = new Context().accumulate({
      operation: "rotate",
      logger: Logging.get(),
    });

    await service.store("ctx-forwarded", "ctx-value", {}, storeCtx);
    expect(createSpy).toHaveBeenCalledWith(
      expect.any(Secret),
      expect.any(Context)
    );

    await service.rotate("ctx-forwarded", "ctx-value-2", {}, rotateCtx);
    expect(updateSpy).toHaveBeenCalledWith(
      expect.any(Secret),
      expect.any(Context)
    );

    createSpy.mockRestore();
    updateSpy.mockRestore();
  });
});
