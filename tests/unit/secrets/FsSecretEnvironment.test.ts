/**
 * @module integrations/tests/fs-secret-environment
 * @summary Environment fallback coverage for the filesystem secret service.
 * @description Verifies `SECRETS__FS__*` resolution plus explicit-config
 * precedence and the `ValidationError` thrown when neither source is present.
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { ValidationError } from "@decaf-ts/db-decorators";
import { FsSecretService } from "../../../src/secrets/fs/FsSecretService";
import {
  DEFAULT_FS_SECRET_KEY_ID,
  DEFAULT_FS_SECRET_ROOT,
} from "../../../src/secrets/fs/FsSecretServiceConfig";

const ENV_KEYS = [
  "SECRETS__FS__ROOT_PATH",
  "SECRETS__FS__KEY_SECRET",
  "SECRETS__FS__KEY_ID",
];

function clearEnv(): void {
  for (const key of ENV_KEYS) delete process.env[key];
}

describe("FsSecretService environment fallback", () => {
  let tempRoot: string;

  beforeAll(async () => {
    tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "decaf-fs-env-"));
  });

  beforeEach(() => {
    clearEnv();
  });

  afterEach(() => {
    clearEnv();
  });

  afterAll(async () => {
    await fs.rm(tempRoot, { recursive: true, force: true });
  });

  it("rejects initialize() with ValidationError when neither config nor environment is present", async () => {
    await expect(new FsSecretService().initialize()).rejects.toBeInstanceOf(
      ValidationError
    );
  });

  it("resolves root path, key secret and key id from SECRETS__FS__* variables", async () => {
    const rootPath = path.join(tempRoot, "env-root");
    process.env.SECRETS__FS__ROOT_PATH = rootPath;
    process.env.SECRETS__FS__KEY_SECRET = "env-key-secret";
    process.env.SECRETS__FS__KEY_ID = "env-key-id";

    const service = new FsSecretService();
    await service.boot();

    expect(service.config).toMatchObject({
      provider: "filesystem",
      rootPath: path.resolve(rootPath),
      keySecret: "env-key-secret",
      keyId: "env-key-id",
    });

    await service.store("env-secret", "env-value");
    await expect(service.retrieve("env-secret")).resolves.toBe("env-value");
  });

  it("falls back to the default root and key id when only the key secret is set", async () => {
    process.env.SECRETS__FS__KEY_SECRET = "env-key-secret";

    const service = new FsSecretService();
    await service.boot();

    expect(service.config.rootPath).toBe(path.resolve(DEFAULT_FS_SECRET_ROOT));
    expect(service.config.keyId).toBe(DEFAULT_FS_SECRET_KEY_ID);
  });

  it("prefers an explicit config over the environment", async () => {
    process.env.SECRETS__FS__ROOT_PATH = path.join(tempRoot, "ignored-env");
    process.env.SECRETS__FS__KEY_SECRET = "env-key-secret";
    process.env.SECRETS__FS__KEY_ID = "env-key-id";

    const explicitRoot = path.join(tempRoot, "explicit");
    const service = new FsSecretService();
    await service.boot({
      provider: "filesystem",
      rootPath: explicitRoot,
      keySecret: "explicit-key-secret",
      keyId: "explicit-key-id",
    });

    expect(service.config).toMatchObject({
      rootPath: path.resolve(explicitRoot),
      keySecret: "explicit-key-secret",
      keyId: "explicit-key-id",
    });
  });
});
