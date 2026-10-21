/**
 * @module integrations/tests/credential-service-unit
 * @summary Unit coverage for {@link CredentialService} with injected fakes.
 * @description Verifies credential metadata lifecycle, name validation, the
 * model-provider guard, secret rollback, summary projection and context
 * forwarding without requiring a persistence adapter.
 */
import { Context, ContextLock, Repository } from "@decaf-ts/core";
import { NotFoundError, ValidationError } from "@decaf-ts/db-decorators";
import { CredentialService } from "../../../src/namespaces/services/credential.service";
import { Credential } from "../../../src/namespaces/models/credential.model";
import {
  CredentialProvider,
  CredentialSummary,
} from "../../../src/namespaces/types";
import {
  SecretPayload,
  SecretReference,
} from "../../../src/secrets/core";

interface RecordedStoreCall {
  name: string;
  value: SecretPayload;
  options: unknown;
  args: unknown[];
}

interface RecordedRotateCall extends RecordedStoreCall {
  newVersion?: string;
}

class FakeSecretStore {
  readonly calls: RecordedStoreCall[] = [];
  readonly rotateCalls: RecordedRotateCall[] = [];
  readonly deleteCalls: Array<{ name: string; options: unknown; args: unknown[] }> =
    [];
  private readonly values = new Map<string, SecretPayload>();

  constructor(
    readonly provider: "model" | "filesystem" = "model"
  ) {}

  async store(
    name: string,
    value: SecretPayload,
    options: unknown = {},
    ...args: unknown[]
  ): Promise<SecretReference> {
    this.calls.push({ name, value, options, args });
    this.values.set(name, value);
    return { provider: this.provider, name };
  }

  async rotate(
    name: string,
    value: SecretPayload,
    options: { newVersion?: string } = {},
    ...args: unknown[]
  ): Promise<SecretReference> {
    this.rotateCalls.push({
      name,
      value,
      options,
      args,
      newVersion: options.newVersion,
    });
    this.values.set(name, value);
    return { provider: this.provider, name, version: options.newVersion };
  }

  async delete(
    nameOrRef: string | SecretReference,
    options: unknown = {},
    ...args: unknown[]
  ): Promise<void> {
    const name =
      typeof nameOrRef === "string" ? nameOrRef : nameOrRef.name;
    this.deleteCalls.push({ name, options, args });
    this.values.delete(name);
  }

  async exists(nameOrRef: string | SecretReference): Promise<boolean> {
    const name =
      typeof nameOrRef === "string" ? nameOrRef : nameOrRef.name;
    return this.values.has(name);
  }

  peek(name: string): SecretPayload | undefined {
    return this.values.get(name);
  }
}

const noopLogger = {
  for() {
    return this;
  },
  verbose() {},
  info() {},
  warn() {},
  error() {},
  debug() {},
  action() {},
};

class FakeCredentialRepository {
  readonly rows = new Map<string, Credential>();
  readonly calls: Array<{ method: string; args: unknown[] }> = [];
  readonly class = Credential;
  readonly _overrides = {};
  readonly _adapter = {
    logCtx: (args: unknown[]) => {
      const ctxArgs = args.filter((arg) => typeof arg !== "undefined");
      return {
        log: noopLogger,
        ctxArgs,
        for: () => ({ log: noopLogger, ctxArgs }),
      };
    },
  };
  failCreate = false;

  seed(row: Credential): Credential {
    this.rows.set(row.id, row);
    return row;
  }

  async create(model: Partial<Credential>, ...args: unknown[]): Promise<Credential> {
    this.calls.push({ method: "create", args });
    if (this.failCreate) throw new Error("insert failed");
    const row = Object.assign({}, model, {
      id: (model as Credential).id ?? "credential-id",
    }) as Credential;
    this.rows.set(row.id, row);
    return row;
  }

  async read(id: string, ...args: unknown[]): Promise<Credential> {
    this.calls.push({ method: "read", args });
    const row = this.rows.get(id);
    if (!row) throw new NotFoundError(`Credential ${id} not found`);
    return row;
  }

  async update(model: Credential, ...args: unknown[]): Promise<Credential> {
    this.calls.push({ method: "update", args });
    this.rows.set(model.id, model);
    return model;
  }

  async delete(id: string, ...args: unknown[]): Promise<Credential> {
    this.calls.push({ method: "delete", args });
    const row = this.rows.get(id);
    if (!row) throw new NotFoundError(`Credential ${id} not found`);
    this.rows.delete(id);
    return row;
  }

  select(): { execute: (...args: unknown[]) => Promise<Credential[]> } {
    return {
      execute: async (...args: unknown[]) => {
        this.calls.push({ method: "select", args });
        return Array.from(this.rows.values());
      },
    };
  }
}

class RecordingContextLock extends ContextLock<any> {
  readonly calls: string[] = [];

  constructor(adapter: AdapterShapedDouble) {
    super(adapter as any);
  }

  async begin(context: Context<any>): Promise<void> {
    this.calls.push("begin");
    return super.begin(context);
  }

  async commit(context: Context<any>): Promise<void> {
    this.calls.push("commit");
    return super.commit(context);
  }

  async rollback(error: Error, context: Context<any>): Promise<void> {
    this.calls.push("rollback");
    return super.rollback(error, context);
  }
}

class AdapterShapedDouble {
  readonly alias = "adapter-shaped-double";
  readonly locks: RecordingContextLock[] = [];
  readonly logCtxCalls: Array<{
    args: unknown[];
    operation: unknown;
    allowCreate: boolean;
  }> = [];

  logCtx(args: unknown[], operation: unknown, allowCreate = false) {
    this.logCtxCalls.push({ args, operation, allowCreate });
    const context = args.find((arg) => arg instanceof Context) as
      | Context<any>
      | undefined;
    const ctx = context ?? new Context();
    const payload = {
      log: noopLogger,
      ctx,
      ctxArgs: [...args, ctx],
      for: () => payload,
    };
    return payload;
  }

  transactionLock(): RecordingContextLock {
    const lock = new RecordingContextLock(this);
    this.locks.push(lock);
    return lock;
  }
}

class AdapterShapedCredentialRepository extends Repository<Credential, any> {
  readonly rows = new Map<string, Credential>();
  readonly calls: Array<{ method: string; args: unknown[] }> = [];
  readonly adapterDouble: AdapterShapedDouble;

  constructor(adapterDouble = new AdapterShapedDouble()) {
    super(undefined as any, undefined as any);
    this.adapterDouble = adapterDouble;
    (this as any)._adapter = adapterDouble;
    (this as any)._class = Credential;
    delete (this as any).create;
    delete (this as any).read;
    delete (this as any).update;
    delete (this as any).delete;
  }

  seed(row: Credential): Credential {
    this.rows.set(row.id, row);
    return row;
  }

  async create(
    model: Partial<Credential>,
    ...args: unknown[]
  ): Promise<Credential> {
    this.calls.push({ method: "create", args });
    const row = Object.assign({}, model, {
      id: (model as Credential).id ?? "credential-id",
    }) as Credential;
    this.rows.set(row.id, row);
    return row;
  }

  async read(id: string, ...args: unknown[]): Promise<Credential> {
    this.calls.push({ method: "read", args });
    const row = this.rows.get(id);
    if (!row) throw new NotFoundError(`Credential ${id} not found`);
    return row;
  }

  async update(model: Credential, ...args: unknown[]): Promise<Credential> {
    this.calls.push({ method: "update", args });
    this.rows.set(model.id, model);
    return model;
  }

  async delete(id: string, ...args: unknown[]): Promise<Credential> {
    this.calls.push({ method: "delete", args });
    const row = this.rows.get(id);
    if (!row) throw new NotFoundError(`Credential ${id} not found`);
    this.rows.delete(id);
    return row;
  }

  select(): { execute: (...args: unknown[]) => Promise<Credential[]> } {
    return {
      execute: async (...args: unknown[]) => {
        this.calls.push({ method: "select", args });
        return Array.from(this.rows.values());
      },
    };
  }
}

function createService(
  store: FakeSecretStore = new FakeSecretStore(),
  repository: FakeCredentialRepository = new FakeCredentialRepository()
): {
  service: CredentialService;
  store: FakeSecretStore;
  repository: FakeCredentialRepository;
} {
  const service = new CredentialService({
    secretService: store,
    repository: repository as any,
  });
  return { service, store, repository };
}

function credentialRow(overrides: Partial<Credential> = {}): Credential {
  return Object.assign(new Credential(), {
    id: "credential-1",
    tenant: "tenant-1",
    name: "database",
    credentialType: "password",
    secretName: "credential-secret",
    provider: CredentialProvider.Model,
    enabled: true,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-01T00:00:00.000Z"),
    ...overrides,
  });
}

describe("CredentialService", () => {
  it("creates a credential row referencing a model-backed secret", async () => {
    const { service, store, repository } = createService();

    const created = await service.createCredential({
      tenantId: "tenant-1",
      orgUnitId: "org-1",
      ownerPrincipalId: "principal-1",
      name: "database",
      credentialType: "password",
      secret: "plaintext-secret",
      description: "primary database",
      metadata: { rotated: "never" },
      expiresAt: new Date("2027-01-01T00:00:00.000Z"),
    });

    expect(store.calls).toHaveLength(1);
    expect(store.calls[0].name).toMatch(/^credential-[0-9a-f-]{36}$/);
    expect(store.calls[0].value).toBe("plaintext-secret");

    expect(repository.rows.size).toBe(1);
    expect(created).toMatchObject({
      id: "credential-id",
      tenant: "tenant-1",
      orgUnit: "org-1",
      owner: "principal-1",
      name: "database",
      credentialType: "password",
      secretName: store.calls[0].name,
      provider: CredentialProvider.Model,
      description: "primary database",
      metadata: { rotated: "never" },
      enabled: true,
    });
    expect(created.expiresAt).toEqual(new Date("2027-01-01T00:00:00.000Z"));
  });

  it("trims the credential name", async () => {
    const { service } = createService();

    const created = await service.createCredential({
      tenantId: "tenant-1",
      name: "  database  ",
      credentialType: "password",
      secret: "plaintext-secret",
    });

    expect(created.name).toBe("database");
  });

  it.each([
    "",
    "   ",
    "bad name",
    "bad/name",
    "-leading-dash",
    "a".repeat(256),
  ])("rejects invalid credential name %p", async (name) => {
    const { service, store, repository } = createService();

    await expect(
      service.createCredential({
        tenantId: "tenant-1",
        name,
        credentialType: "password",
        secret: "plaintext-secret",
      })
    ).rejects.toBeInstanceOf(ValidationError);

    expect(store.calls).toHaveLength(0);
    expect(repository.calls).toHaveLength(0);
  });

  it("rejects a non-model secret provider", async () => {
    const store = new FakeSecretStore("filesystem");
    const { service } = createService(store);

    await expect(
      service.createCredential({
        tenantId: "tenant-1",
        name: "database",
        credentialType: "password",
        secret: "plaintext-secret",
      })
    ).rejects.toBeInstanceOf(ValidationError);

    expect(store.calls).toHaveLength(0);
  });

  it("rolls back the stored secret when row creation fails", async () => {
    const { service, store, repository } = createService();
    repository.failCreate = true;

    await expect(
      service.createCredential({
        tenantId: "tenant-1",
        name: "database",
        credentialType: "password",
        secret: "plaintext-secret",
      })
    ).rejects.toThrow("insert failed");

    expect(store.deleteCalls).toHaveLength(1);
    expect(store.deleteCalls[0]).toMatchObject({
      name: store.calls[0].name,
      options: { force: true },
    });
    expect(store.peek(store.calls[0].name)).toBeUndefined();
  });

  it("rotates the referenced secret and updates the row", async () => {
    const repository = new FakeCredentialRepository();
    repository.seed(credentialRow());
    const { service, store } = createService(
      new FakeSecretStore(),
      repository
    );

    const updated = await service.rotateCredential({
      credentialId: "credential-1",
      secret: "new-plaintext-secret",
      version: "v2",
    });

    expect(store.rotateCalls).toHaveLength(1);
    expect(store.rotateCalls[0]).toMatchObject({
      name: "credential-secret",
      value: "new-plaintext-secret",
      newVersion: "v2",
    });
    expect(updated.id).toBe("credential-1");
    expect(updated.updatedAt).toBeInstanceOf(Date);
    expect(repository.rows.get("credential-1")).toBe(updated);
  });

  it("falls back to store() when the secret store has no rotate()", async () => {
    const repository = new FakeCredentialRepository();
    repository.seed(credentialRow());
    const store = new FakeSecretStore("model");
    (store as any).rotate = undefined;
    const { service } = createService(store, repository);

    await service.rotateCredential({
      credentialId: "credential-1",
      secret: "new-plaintext-secret",
      version: "v2",
    });

    expect(store.calls).toHaveLength(1);
    expect(store.calls[0]).toMatchObject({
      name: "credential-secret",
      value: "new-plaintext-secret",
      options: { version: "v2" },
    });
  });

  it("returns plain metadata from getCredential", async () => {
    const repository = new FakeCredentialRepository();
    repository.seed(credentialRow());
    const { service } = createService(new FakeSecretStore(), repository);

    await expect(service.getCredential("credential-1")).resolves.toMatchObject({
      id: "credential-1",
      name: "database",
      secretName: "credential-secret",
    });
  });

  it("lists credential summaries without secret values", async () => {
    const repository = new FakeCredentialRepository();
    repository.seed(
      credentialRow({
        id: "credential-1",
        tenant: "tenant-1",
        orgUnit: { id: "org-1" } as any,
        owner: { id: "principal-1" } as any,
        metadata: { label: "primary" },
      })
    );
    repository.seed(
      credentialRow({
        id: "credential-2",
        name: "api-token",
        tenant: { id: "tenant-1" } as any,
      })
    );
    const { service } = createService(new FakeSecretStore(), repository);

    const summaries: CredentialSummary[] = await service.listCredentials();

    expect(summaries).toHaveLength(2);
    expect(summaries[0]).toMatchObject({
      id: "credential-1",
      tenantId: "tenant-1",
      orgUnitId: "org-1",
      ownerPrincipalId: "principal-1",
      name: "database",
      provider: CredentialProvider.Model,
      metadata: { label: "primary" },
    });
    expect(summaries[1]).toMatchObject({
      id: "credential-2",
      tenantId: "tenant-1",
      name: "api-token",
    });
    expect(JSON.stringify(summaries)).not.toContain("plaintext-secret");
    expect(
      summaries.every((summary) => !("secretName" in summary))
    ).toBe(true);
  });

  it("marks a credential as used without touching the secret", async () => {
    const repository = new FakeCredentialRepository();
    repository.seed(credentialRow());
    const { service, store } = createService(
      new FakeSecretStore(),
      repository
    );

    const updated = await service.markCredentialUsed("credential-1");

    expect(updated.lastUsedAt).toBeInstanceOf(Date);
    expect(store.calls).toHaveLength(0);
    expect(store.deleteCalls).toHaveLength(0);
  });

  it("deletes the credential row and its secret", async () => {
    const repository = new FakeCredentialRepository();
    repository.seed(credentialRow());
    const { service, store } = createService(
      new FakeSecretStore(),
      repository
    );

    await service.deleteCredential("credential-1");

    expect(repository.rows.has("credential-1")).toBe(false);
    expect(store.deleteCalls).toHaveLength(1);
    expect(store.deleteCalls[0]).toMatchObject({
      name: "credential-secret",
      options: { force: true },
    });
  });

  it("forwards context args to the secret store and repository", async () => {
    const { service, store, repository } = createService();
    const ctx = new Context();

    await service.createCredential(
      {
        tenantId: "tenant-1",
        name: "database",
        credentialType: "password",
        secret: "plaintext-secret",
      },
      ctx
    );

    expect(store.calls[0].args.at(-1)).toBe(ctx);
    const createCall = repository.calls.find(
      (call) => call.method === "create"
    );
    expect(createCall?.args.at(-1)).toBe(ctx);
  });

  describe("ctx-less regression (SAA-1197)", () => {
    it("resolves a ctx-less getCredential with exactly one repository read", async () => {
      const repository = new FakeCredentialRepository();
      repository.seed(credentialRow());
      const { service } = createService(new FakeSecretStore(), repository);

      const credential = await service.getCredential("credential-1");

      expect(credential).toMatchObject({
        id: "credential-1",
        name: "database",
        secretName: "credential-secret",
      });
      expect(
        repository.calls.filter((call) => call.method === "read")
      ).toHaveLength(1);
      expect(repository.calls).toHaveLength(1);
    });

    it("resolves a ctx-less markCredentialUsed with one read and one update", async () => {
      const repository = new FakeCredentialRepository();
      repository.seed(credentialRow());
      const { service } = createService(new FakeSecretStore(), repository);

      const updated = await service.markCredentialUsed("credential-1");

      expect(updated.id).toBe("credential-1");
      expect(updated.lastUsedAt).toBeInstanceOf(Date);
      expect(
        repository.calls.filter((call) => call.method === "read")
      ).toHaveLength(1);
      expect(
        repository.calls.filter((call) => call.method === "update")
      ).toHaveLength(1);
      expect(repository.calls).toHaveLength(2);
      expect(repository.rows.get("credential-1")).toBe(updated);
    });

    it("takes the adapter transaction path on a ctx-less getCredential", async () => {
      const adapterDouble = new AdapterShapedDouble();
      const repository = new AdapterShapedCredentialRepository(adapterDouble);
      repository.seed(credentialRow());
      const { service } = createService(new FakeSecretStore(), repository);

      const credential = await service.getCredential("credential-1");

      expect(credential.id).toBe("credential-1");
      expect(
        repository.calls.filter((call) => call.method === "read")
      ).toHaveLength(1);
      expect(adapterDouble.locks).toHaveLength(1);
      const lock = adapterDouble.locks[0];
      expect(lock.calls).toEqual(["begin", "commit"]);
      expect(lock.depth).toBe(0);
    });

    it("takes the adapter transaction path on a ctx-less markCredentialUsed", async () => {
      const adapterDouble = new AdapterShapedDouble();
      const repository = new AdapterShapedCredentialRepository(adapterDouble);
      repository.seed(credentialRow());
      const { service } = createService(new FakeSecretStore(), repository);

      const updated = await service.markCredentialUsed("credential-1");

      expect(updated.lastUsedAt).toBeInstanceOf(Date);
      expect(repository.calls.map((call) => call.method)).toEqual([
        "read",
        "update",
      ]);
      expect(adapterDouble.locks).toHaveLength(1);
      const lock = adapterDouble.locks[0];
      expect(lock.calls).toEqual(["begin", "commit"]);
      expect(lock.depth).toBe(0);
    });

    it("reuses an in-flight transaction lock on a nested call", async () => {
      const adapterDouble = new AdapterShapedDouble();
      const repository = new AdapterShapedCredentialRepository(adapterDouble);
      repository.seed(credentialRow());
      const { service } = createService(new FakeSecretStore(), repository);

      const ctx = new Context().accumulate({
        operation: "outerTransaction",
      } as any);
      const inFlight = adapterDouble.transactionLock();
      await inFlight.begin(ctx);
      inFlight.depth = 1;
      ctx.cache.put("transactionLock", inFlight);

      const credential = await service.getCredential("credential-1", ctx);

      expect(credential.id).toBe("credential-1");
      expect(
        repository.calls.filter((call) => call.method === "read")
      ).toHaveLength(1);
      expect(adapterDouble.locks).toHaveLength(1);
      expect(adapterDouble.locks[0]).toBe(inFlight);
      expect(inFlight.calls).toEqual(["begin"]);
      expect(inFlight.depth).toBe(1);
    });
  });
});
