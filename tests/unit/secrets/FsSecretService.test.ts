/**
 * @module integrations/tests/fs-secret-service
 * @summary Unit coverage for the filesystem-backed secret service.
 * @description Exercises the AES-GCM envelope written by {@link FsSecretService},
 * its file/directory permissions, version handling, unsupported operations, and
 * deletion semantics without requiring a database or external service.
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { NotFoundError } from "@decaf-ts/db-decorators";
import { FsSecretService } from "../../../src/secrets/fs/FsSecretService";
import { DEFAULT_FS_SECRET_KEY_ID } from "../../../src/secrets/fs/FsSecretServiceConfig";
import { SecretError } from "../../../src/secrets/core/SecretErrors";

function uniqueName(prefix = "secret"): string {
  return `${prefix}-${randomUUID()}`;
}

describe("FsSecretService", () => {
  let root: string;
  let service: FsSecretService;

  beforeAll(async () => {
    root = path.join(
      await fs.mkdtemp(path.join(os.tmpdir(), "decaf-fs-secrets-")),
      "store"
    );
    service = new FsSecretService();
    await service.boot({
      provider: "filesystem",
      rootPath: root,
      keySecret: "unit-test-key",
      keyId: "unit-key-id",
    });
  });

  afterAll(async () => {
    await fs.rm(path.dirname(root), { recursive: true, force: true });
  });

  it("boots from explicit config and creates a private root directory", async () => {
    expect(service.provider).toBe("filesystem");
    expect(service.config).toMatchObject({
      provider: "filesystem",
      rootPath: path.resolve(root),
      keySecret: "unit-test-key",
      keyId: "unit-key-id",
    });

    const stat = await fs.stat(root);
    expect(stat.isDirectory()).toBe(true);
    expect(stat.mode & 0o777).toBe(0o700);
  });

  it("stores and retrieves string payloads encrypted at rest", async () => {
    const name = uniqueName("string");
    const plaintext = "super-secret-value";

    const reference = await service.store(name, plaintext);
    expect(reference).toMatchObject({
      provider: "filesystem",
      name,
      path: path.join(root, `${name}.json`),
    });

    await expect(service.retrieve(name)).resolves.toBe(plaintext);

    const raw = await fs.readFile(reference.path as string, "utf8");
    expect(raw).not.toContain(plaintext);
    expect(raw).not.toContain("unit-test-key");
    expect(JSON.parse(raw)).toMatchObject({
      schema: "decaf.fs-secret.v1",
      name,
      provider: "filesystem",
    });

    const stat = await fs.stat(reference.path as string);
    expect(stat.mode & 0o777).toBe(0o600);
  });

  it("stores and retrieves JSON object payloads", async () => {
    const name = uniqueName("object");
    const payload = {
      username: "service-account",
      nested: { token: "abc-123" },
      retries: 3,
    };

    await service.store(name, payload, { contentType: "application/json" });
    await expect(service.retrieve(name)).resolves.toEqual(payload);
  });

  it("uses the default key id when none is provided", async () => {
    const defaultService = new FsSecretService();
    await defaultService.boot({
      provider: "filesystem",
      rootPath: path.join(root, "default-key"),
      keySecret: "unit-test-key",
    });
    expect(defaultService.config.keyId).toBe(DEFAULT_FS_SECRET_KEY_ID);
  });

  it("reports existence, including version-specific existence", async () => {
    const name = uniqueName("exists");

    await expect(service.exists(name)).resolves.toBe(false);
    await service.store(name, "v1-value", { version: "v1" });
    await expect(service.exists(name)).resolves.toBe(true);
    await expect(service.exists(name, { version: "v1" })).resolves.toBe(true);
    await expect(service.exists(name, { version: "v2" })).resolves.toBe(false);
  });

  it("retrieves a specific version and rejects a different version", async () => {
    const name = uniqueName("version");
    await service.store(name, "versioned-value", { version: "v1" });

    await expect(
      service.retrieve(name, { version: "v1" })
    ).resolves.toBe("versioned-value");
    await expect(
      service.retrieve(name, { version: "v2" })
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it("rotates by replacing the stored envelope and version", async () => {
    const name = uniqueName("rotate");
    await service.store(name, "old-value", { version: "v1" });

    const reference = await service.rotate(
      name,
      "new-value",
      { oldVersion: "v1", newVersion: "v2" }
    );
    expect(reference.version).toBe("v2");

    await expect(
      service.retrieve(name, { version: "v2" })
    ).resolves.toBe("new-value");
    await expect(
      service.retrieve(name, { version: "v1" })
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it("always rejects list() with SECRET_UNSUPPORTED_OPERATION", async () => {
    await expect(service.list()).rejects.toMatchObject({
      secretCode: "SECRET_UNSUPPORTED_OPERATION",
    });
  });

  it("always rejects metadata() with SECRET_UNSUPPORTED_OPERATION", async () => {
    await expect(service.metadata("any-secret")).rejects.toMatchObject({
      secretCode: "SECRET_UNSUPPORTED_OPERATION",
    });
  });

  it("deletes secrets and is idempotent on repeat deletes", async () => {
    const name = uniqueName("delete");
    await service.store(name, "to-be-deleted");
    await expect(service.exists(name)).resolves.toBe(true);

    await service.delete(name);
    await expect(service.exists(name)).resolves.toBe(false);
    await expect(service.retrieve(name)).rejects.toBeInstanceOf(NotFoundError);
    await expect(service.delete(name)).resolves.toBeUndefined();
  });

  it("rejects invalid secret names", async () => {
    await expect(service.store("../escape", "value")).rejects.toMatchObject({
      secretCode: "SECRET_INVALID_NAME",
    });
    await expect(service.retrieve("invalid name")).rejects.toBeInstanceOf(
      SecretError
    );
  });

  it("reports missing secrets as NotFoundError", async () => {
    await expect(service.retrieve(uniqueName("missing"))).rejects.toBeInstanceOf(
      NotFoundError
    );
  });
});
