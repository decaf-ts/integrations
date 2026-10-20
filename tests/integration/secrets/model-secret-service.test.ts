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
import { SecretError } from "../../../src/secrets/core/SecretErrors";

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

  async function waitUntilAfterLatestUpdate(name: string): Promise<void> {
    const rows = await secretsNamed(name);
    const latest = rows.reduce((max, row) => {
      const time = row.updatedAt ? new Date(row.updatedAt).getTime() : 0;
      return Math.max(max, time);
    }, 0);
    while (Date.now() <= latest) {
      await new Promise((resolve) => setTimeout(resolve, 1));
    }
  }

  function rowsByVersion(rows: Secret[]): Record<string, Secret> {
    return Object.fromEntries(rows.map((row) => [row.version ?? "", row]));
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

  describe("name/version uniqueness", () => {
    it("rejects a duplicate name without a version and keeps a single row", async () => {
      await service.store("duplicate-name", "first-value");

      const failure = await service
        .store("duplicate-name", "second-value")
        .catch((error) => error);

      expect(failure).toBeInstanceOf(SecretError);
      expect(failure.secretCode).toBe("SECRET_ALREADY_EXISTS");
      const rows = await secretsNamed("duplicate-name");
      expect(rows).toHaveLength(1);
      await expect(service.retrieve("duplicate-name")).resolves.toBe(
        "first-value"
      );
    });

    it("treats an absent version and an empty version as the same version", async () => {
      await service.store("blank-version-name", "value-without-version");

      const failure = await service
        .store("blank-version-name", "value-with-blank-version", {
          version: "",
        })
        .catch((error) => error);

      expect(failure).toBeInstanceOf(SecretError);
      expect(failure.secretCode).toBe("SECRET_ALREADY_EXISTS");
      await expect(secretsNamed("blank-version-name")).resolves.toHaveLength(1);
      await expect(service.retrieve("blank-version-name")).resolves.toBe(
        "value-without-version"
      );
    });

    it("allows the same name at different versions and retrieves each payload", async () => {
      await service.store("versioned-secret", "v1-payload", { version: "v1" });
      await waitUntilAfterLatestUpdate("versioned-secret");
      await service.store("versioned-secret", "v2-payload", { version: "v2" });

      const rows = await secretsNamed("versioned-secret");
      expect(rows).toHaveLength(2);
      expect(Object.keys(rowsByVersion(rows)).sort()).toEqual(["v1", "v2"]);

      await expect(
        service.retrieve("versioned-secret", { version: "v1" })
      ).resolves.toBe("v1-payload");
      await expect(
        service.retrieve("versioned-secret", { version: "v2" })
      ).resolves.toBe("v2-payload");
      await expect(service.retrieve("versioned-secret")).resolves.toBe(
        "v2-payload"
      );
      await expect(
        service.metadata("versioned-secret").then((meta) => meta?.version)
      ).resolves.toBe("v2");
      await expect(
        service
          .metadata("versioned-secret", { version: "v1" })
          .then((meta) => meta?.version)
      ).resolves.toBe("v1");

      const duplicateVersion = await service
        .store("versioned-secret", "v1-again", { version: "v1" })
        .catch((error) => error);
      expect(duplicateVersion).toBeInstanceOf(SecretError);
      expect(duplicateVersion.secretCode).toBe("SECRET_ALREADY_EXISTS");
      await expect(secretsNamed("versioned-secret")).resolves.toHaveLength(2);
      await expect(
        service.retrieve("versioned-secret", { version: "v1" })
      ).resolves.toBe("v1-payload");
    });

    it("soft-deletes and force-deletes the deterministic newest version only", async () => {
      const name = "deterministic-delete-secret";
      await service.store(name, "one", { version: "v1" });
      await waitUntilAfterLatestUpdate(name);
      await service.store(name, "two", { version: "v2" });

      await expect(service.exists(name)).resolves.toBe(true);
      await expect(service.exists(name, { version: "v1" })).resolves.toBe(true);
      await expect(service.exists(name, { version: "v2" })).resolves.toBe(true);

      await service.delete(name);
      const afterSoftDelete = rowsByVersion(await secretsNamed(name));
      expect(Object.keys(afterSoftDelete).sort()).toEqual(["v1", "v2"]);
      expect(afterSoftDelete.v2.enabled).toBe(false);
      expect(afterSoftDelete.v1.enabled).toBe(true);
      await expect(service.exists(name)).resolves.toBe(true);
      await expect(service.exists(name, { version: "v2" })).resolves.toBe(false);
      await expect(service.retrieve(name)).resolves.toBe("one");

      await service.delete(name, { force: true });
      const afterForceDelete = rowsByVersion(await secretsNamed(name));
      expect(Object.keys(afterForceDelete)).toEqual(["v1"]);
      await expect(service.exists(name)).resolves.toBe(true);
      await expect(service.retrieve(name)).resolves.toBe("one");

      await service.delete(name, { force: true });
      await expect(secretsNamed(name)).resolves.toHaveLength(0);
      await expect(service.exists(name)).resolves.toBe(false);
    });

    it("rotates the deterministic newest version and keeps the older version intact", async () => {
      const name = "deterministic-rotate-secret";
      await service.store(name, "one", { version: "v1" });
      await waitUntilAfterLatestUpdate(name);
      await service.store(name, "two", { version: "v2" });

      const rotated = await service.rotate(name, "two-rotated", {
        newVersion: "v3",
      });

      expect(rotated).toMatchObject({ name, version: "v3" });
      const rows = rowsByVersion(await secretsNamed(name));
      expect(Object.keys(rows).sort()).toEqual(["v1", "v3"]);
      await expect(
        service.retrieve(name, { version: "v3" })
      ).resolves.toBe("two-rotated");
      await expect(
        service.retrieve(name, { version: "v1" })
      ).resolves.toBe("one");
    });

    it("maps a rotate to a version held by another row to SECRET_ALREADY_EXISTS", async () => {
      const name = "rotate-conflict-secret";
      await service.store(name, "one", { version: "v1" });
      await waitUntilAfterLatestUpdate(name);
      await service.store(name, "two", { version: "v2" });

      const outcome = await service
        .rotate(name, "conflict", { oldVersion: "v1", newVersion: "v2" })
        .then(
          (value) => ({ resolved: true as const, value }),
          (error) => ({ resolved: false as const, error })
        );

      if (outcome.resolved) {
        const versions = (await secretsNamed(name)).map(
          (row) => row.version ?? ""
        );
        throw new Error(
          `rotate to a version held by another row succeeded; rows now hold versions ${JSON.stringify(
            versions.sort()
          )} instead of rejecting with SECRET_ALREADY_EXISTS`
        );
      }
      expect(outcome.error).toBeInstanceOf(SecretError);
      expect(outcome.error.secretCode).toBe("SECRET_ALREADY_EXISTS");

      const rows = rowsByVersion(await secretsNamed(name));
      expect(Object.keys(rows).sort()).toEqual(["v1", "v2"]);
      await expect(
        service.retrieve(name, { version: "v1" })
      ).resolves.toBe("one");
      await expect(
        service.retrieve(name, { version: "v2" })
      ).resolves.toBe("two");
    });
  });
});
