/**
 * @module integrations/tests/blob-service-boot
 * @summary Verifies the PTP-1016 blob auto-boot config-resolution fix.
 * @description `Service.boot(new Context())` drives every registered
 * `ClientBasedService`, passing it a decaf `Context` (not a blob config). A
 * provider must therefore resolve its config from its own `blobs.<provider>`
 * environment slice, or be skipped when unconfigured, instead of throwing and
 * blocking the whole service graph from booting. These tests cover:
 *  1. `Service.boot(new Context())` succeeds when `BLOBS__S3__*` is set and S3
 *     initializes from its environment slice.
 *  2. Unconfigured providers (`blob-minio`/`blob-r2`) are skipped and do not
 *     throw during boot.
 *  3. A decaf `Context` passed as the first `initialize()` arg is NOT mistaken
 *     for a config object.
 *
 * The decorated blob services are registered manually: this package's ts-jest
 * config supplies an inline compiler-options object that does not carry the
 * project's `experimentalDecorators`, so the `@service("blob-*")` class
 * decorators are not emitted and the injectable service registry is empty at
 * runtime. Applying the `service()` decorator directly reproduces the production
 * registration so `Service.boot` is exercised end-to-end.
 *
 * Run with `NODE_OPTIONS="--experimental-vm-modules"` (as `npm run test:unit`
 * already does).
 */
import { service, Service, Context } from "@decaf-ts/core";
import { ValidationError } from "@decaf-ts/db-decorators";
import { S3BlobStoreService } from "../../../src/blob/s3/S3BlobStoreService";
import { MinioBlobStoreService } from "../../../src/blob/s3/MinioBlobStoreService";
import { R2BlobStoreService } from "../../../src/blob/s3/R2BlobStoreService";

const ENV_KEYS = [
  "BLOBS__S3__SOURCE_ID",
  "BLOBS__S3__BUCKET",
  "BLOBS__S3__REGION",
  "BLOBS__MINIO__SOURCE_ID",
  "BLOBS__MINIO__BUCKET",
  "BLOBS__MINIO__ENDPOINT",
  "BLOBS__R2__SOURCE_ID",
  "BLOBS__R2__BUCKET",
  "BLOBS__R2__ENDPOINT",
];

function clearEnv(): void {
  for (const key of ENV_KEYS) delete process.env[key];
}

function seedS3Env(sourceId: string, bucket: string): void {
  process.env.BLOBS__S3__SOURCE_ID = sourceId;
  process.env.BLOBS__S3__BUCKET = bucket;
  process.env.BLOBS__S3__REGION = "us-east-1";
}

function registerBlobServices(): void {
  service("blob-s3")(S3BlobStoreService as any);
  service("blob-minio")(MinioBlobStoreService as any);
  service("blob-r2")(R2BlobStoreService as any);
}

// A Context that carries the `operation` flag the auto-boot path accumulates
// (via `flags()`). A bare `new Context()` has no flags and makes the
// `logCtx`/`context()` plumbing throw an unrelated "operation key does not
// exist" error, so this reproduces the Context shape `Service.boot` hands to
// `initialize()`.
function bootLikeContext(): Context {
  return new Context().accumulate({ operation: "initialize" });
}

describe("Blob store auto-boot config resolution", () => {
  beforeAll(() => {
    registerBlobServices();
  });

  afterEach(() => {
    clearEnv();
  });

  describe("Service.boot(new Context())", () => {
    it("boots S3 from its environment slice and skips unconfigured providers", async () => {
      seedS3Env("s3-env-test", "env-bucket");

      await expect(Service.boot(new Context())).resolves.toBeUndefined();

      const s3 = Service.get<S3BlobStoreService>("blob-s3");
      expect(s3.provider).toBe("s3");
      expect(s3.sourceId).toBe("s3-env-test");
      expect(s3.config.bucket).toBe("env-bucket");

      const minio = Service.get<MinioBlobStoreService>("blob-minio");
      const r2 = Service.get<R2BlobStoreService>("blob-r2");
      expect(() => minio.config).toThrow();
      expect(() => r2.config).toThrow();
    });

    it("skips every unconfigured provider without throwing", async () => {
      await expect(Service.boot(new Context())).resolves.toBeUndefined();

      for (const key of ["blob-s3", "blob-minio", "blob-r2"]) {
        const service = Service.get<any>(key);
        expect(() => service.config).toThrow();
      }
    });
  });

  describe("Context passed as the first initialize arg", () => {
    it("is not mistaken for a config when env is set (S3 initializes from env)", async () => {
      seedS3Env("ctx-s3", "ctx-bucket");

      const store = new S3BlobStoreService();
      await store.initialize(bootLikeContext());

      expect(store.provider).toBe("s3");
      expect(store.sourceId).toBe("ctx-s3");
      expect(store.config.bucket).toBe("ctx-bucket");
    });

    it("auto-boot with only a Context and no config/env skips instead of throwing", async () => {
      const store = new S3BlobStoreService();
      await expect(store.initialize(bootLikeContext())).resolves.toEqual({
        config: undefined,
        client: undefined,
      });
      expect(() => store.config).toThrow();
    });
  });

  describe("explicit non-config args still fail loudly", () => {
    it("throws ValidationError for a no-provider object with no env and no context", async () => {
      const store = new S3BlobStoreService();
      await expect(
        store.initialize({ sourceId: "no-provider" } as any)
      ).rejects.toThrow(ValidationError);
    });
  });
});
