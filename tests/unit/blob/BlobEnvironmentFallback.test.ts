/**
 * @module integrations/tests/blob-environment-fallback
 * @summary Verifies the config-or-environment fallback added to blob store services.
 * @description Each provider must still accept an explicit config as the first
 * `initialize()` argument (unchanged behavior), but can now also resolve its config
 * from its own `blobs.<provider>` environment slice (via real process.env variables,
 * e.g. `BLOBS__AZURE__CONTAINER`) when no config is passed, and must throw when
 * neither is available.
 *
 * Real env vars are used rather than calling `.accumulate()` directly on the exported
 * per-provider Environment objects: every provider's environment shares the same
 * `blobs` root key on the underlying `@decaf-ts/logging` Environment singleton, and
 * that class re-captures its whole-object closure on every `.accumulate()` call for a
 * given root key — so seeding provider A and then provider B via `.accumulate()` can
 * make A's previously-seeded values unreadable through `A.blobs.<x>` again. Real env
 * vars are read directly from `process.env` at access time and are not affected by
 * that ordering, which is why `configFromEnvironment()` is built to trust `typeof
 * value === "string"` (see `envString`) rather than a bare truthiness check: unset
 * paths resolve to a Proxy object (for env-key composition), not `undefined`.
 *
 * Run with `NODE_OPTIONS="--experimental-vm-modules"` (as `npm run test:unit` etc.
 * already do) — that's what makes Jest resolve `kubo-rpc-client` (an ESM-only
 * package) for `IpfsBlobStoreService`. Without it, Jest's CJS-style resolver can't
 * find a package that only declares `import`/`module-sync` export conditions.
 */
import os from "os";
import path from "path";
import { rm } from "fs/promises";
import { ValidationError } from "@decaf-ts/db-decorators";
import { MemoryBlobStoreService } from "../../../src/blob/memory/MemoryBlobStoreService";
import { LocalBlobStoreService } from "../../../src/blob/local/LocalBlobStoreService";
import { AzureBlobStoreService } from "../../../src/blob/azure/AzureBlobStoreService";
import { S3BlobStoreService } from "../../../src/blob/s3/S3BlobStoreService";
import { MinioBlobStoreService } from "../../../src/blob/s3/MinioBlobStoreService";
import { R2BlobStoreService } from "../../../src/blob/s3/R2BlobStoreService";
import { GcsBlobStoreService } from "../../../src/blob/gcp/GcsBlobStoreService";
import { IpfsBlobStoreService } from "../../../src/blob/ipfs/IpfsBlobStoreService";

const azuriteConnectionString =
  "DefaultEndpointsProtocol=http;AccountName=devstoreaccount1;AccountKey=Eby8vdM02xNOcqFlqUwJPLlmEtlCDXJ1OUzFT50uSRZ6IFsuFq2UVErCz4I6tq/K1SZFPTOtr/KBHBeksoGMGw==;BlobEndpoint=http://localhost:10000/devstoreaccount1;";

const ENV_KEYS = [
  "BLOBS__MEMORY__SOURCE_ID",
  "BLOBS__MEMORY__PREFIX",
  "BLOBS__LOCAL__SOURCE_ID",
  "BLOBS__LOCAL__ROOT_PATH",
  "BLOBS__AZURE__SOURCE_ID",
  "BLOBS__AZURE__CONTAINER",
  "BLOBS__AZURE__CONNECTION_STRING",
  "BLOBS__S3__SOURCE_ID",
  "BLOBS__S3__BUCKET",
  "BLOBS__S3__REGION",
  "BLOBS__MINIO__SOURCE_ID",
  "BLOBS__MINIO__BUCKET",
  "BLOBS__MINIO__ENDPOINT",
  "BLOBS__MINIO__FORCE_PATH_STYLE",
  "BLOBS__R2__SOURCE_ID",
  "BLOBS__R2__BUCKET",
  "BLOBS__R2__ENDPOINT",
  "BLOBS__GCS__SOURCE_ID",
  "BLOBS__GCS__BUCKET",
  "BLOBS__GCS__PROJECT_ID",
  "BLOBS__IPFS__SOURCE_ID",
];

function clearEnv(): void {
  for (const key of ENV_KEYS) delete process.env[key];
}

describe("Blob environment fallback", () => {
  afterEach(() => {
    clearEnv();
  });

  describe("throws when neither config nor environment is provided", () => {
    it("AzureBlobStoreService", async () => {
      await expect(new AzureBlobStoreService().initialize()).rejects.toThrow(
        ValidationError
      );
    });

    it("S3BlobStoreService", async () => {
      await expect(new S3BlobStoreService().initialize()).rejects.toThrow(
        ValidationError
      );
    });

    it("MinioBlobStoreService", async () => {
      await expect(new MinioBlobStoreService().initialize()).rejects.toThrow(
        ValidationError
      );
    });

    it("R2BlobStoreService", async () => {
      await expect(new R2BlobStoreService().initialize()).rejects.toThrow(
        ValidationError
      );
    });

    it("GcsBlobStoreService", async () => {
      await expect(new GcsBlobStoreService().initialize()).rejects.toThrow(
        ValidationError
      );
    });

    it("LocalBlobStoreService", async () => {
      await expect(new LocalBlobStoreService().initialize()).rejects.toThrow(
        ValidationError
      );
    });

    it("MemoryBlobStoreService", async () => {
      await expect(new MemoryBlobStoreService().initialize()).rejects.toThrow(
        ValidationError
      );
    });

    it("IpfsBlobStoreService", async () => {
      await expect(new IpfsBlobStoreService().initialize()).rejects.toThrow(
        ValidationError
      );
    });
  });

  describe("Memory: full CRUD via environment-sourced config", () => {
    beforeEach(() => {
      process.env.BLOBS__MEMORY__SOURCE_ID = "memory-env-test";
      process.env.BLOBS__MEMORY__PREFIX = "tenant/env";
    });

    it("initializes and operates without an explicit config", async () => {
      const store = new MemoryBlobStoreService();
      await store.initialize();
      expect(store.sourceId).toBe("memory-env-test");
      await store.put("doc.txt", Buffer.from("hello"));
      const list = await store.list();
      expect(list.items[0].key).toBe("tenant/env/doc.txt");
    });

    it("still honors an explicit config passed as the first argument", async () => {
      const store = new MemoryBlobStoreService();
      await store.initialize({ provider: "memory", sourceId: "explicit" });
      expect(store.sourceId).toBe("explicit");
    });
  });

  describe("Local: full CRUD via environment-sourced config", () => {
    let root: string;

    beforeEach(() => {
      root = path.join(os.tmpdir(), `decaf-blob-env-test-${Date.now()}`);
      process.env.BLOBS__LOCAL__SOURCE_ID = "local-env-test";
      process.env.BLOBS__LOCAL__ROOT_PATH = root;
    });

    afterEach(async () => {
      await rm(root, { recursive: true, force: true });
    });

    it("initializes and operates without an explicit config", async () => {
      const store = new LocalBlobStoreService();
      await store.initialize();
      expect(store.sourceId).toBe("local-env-test");
      await store.put("doc.txt", Buffer.from("hello"));
      expect(await store.has("doc.txt")).toBe(true);
    });
  });

  describe("Network providers resolve config from environment", () => {
    it("AzureBlobStoreService initializes without an explicit config", async () => {
      process.env.BLOBS__AZURE__SOURCE_ID = "azure-env-test";
      process.env.BLOBS__AZURE__CONTAINER = "env-container";
      process.env.BLOBS__AZURE__CONNECTION_STRING = azuriteConnectionString;

      const store = new AzureBlobStoreService();
      await store.initialize();
      expect(store.sourceId).toBe("azure-env-test");
      expect(store.provider).toBe("azure-blob");
    });

    it("S3BlobStoreService resolves config from environment", () => {
      process.env.BLOBS__S3__SOURCE_ID = "s3-env-test";
      process.env.BLOBS__S3__BUCKET = "env-bucket";
      process.env.BLOBS__S3__REGION = "us-east-1";

      const store = new S3BlobStoreService();
      const config = (store as any).configFromEnvironment();
      expect(config).toEqual(
        expect.objectContaining({
          provider: "s3",
          sourceId: "s3-env-test",
          bucket: "env-bucket",
          region: "us-east-1",
        })
      );
    });

    it("MinioBlobStoreService resolves config from environment", () => {
      process.env.BLOBS__MINIO__SOURCE_ID = "minio-env-test";
      process.env.BLOBS__MINIO__BUCKET = "env-bucket";
      process.env.BLOBS__MINIO__ENDPOINT = "http://localhost:9000";
      process.env.BLOBS__MINIO__FORCE_PATH_STYLE = "true";

      const store = new MinioBlobStoreService();
      const config = (store as any).configFromEnvironment();
      expect(config).toEqual(
        expect.objectContaining({
          provider: "minio",
          sourceId: "minio-env-test",
          bucket: "env-bucket",
          endpoint: "http://localhost:9000",
          forcePathStyle: true,
        })
      );
    });

    it("R2BlobStoreService resolves config from environment", () => {
      process.env.BLOBS__R2__SOURCE_ID = "r2-env-test";
      process.env.BLOBS__R2__BUCKET = "env-bucket";
      process.env.BLOBS__R2__ENDPOINT =
        "https://example.r2.cloudflarestorage.com";

      const store = new R2BlobStoreService();
      const config = (store as any).configFromEnvironment();
      expect(config).toEqual(
        expect.objectContaining({
          provider: "r2",
          sourceId: "r2-env-test",
          bucket: "env-bucket",
          endpoint: "https://example.r2.cloudflarestorage.com",
        })
      );
    });

    it("GcsBlobStoreService initializes without an explicit config", async () => {
      process.env.BLOBS__GCS__SOURCE_ID = "gcs-env-test";
      process.env.BLOBS__GCS__BUCKET = "env-bucket";
      process.env.BLOBS__GCS__PROJECT_ID = "env-project";

      const store = new GcsBlobStoreService();
      await store.initialize();
      expect(store.sourceId).toBe("gcs-env-test");
      expect(store.provider).toBe("gcs");
    });

    it("IpfsBlobStoreService initializes without an explicit config", async () => {
      process.env.BLOBS__IPFS__SOURCE_ID = "ipfs-env-test";

      const store = new IpfsBlobStoreService();
      await store.initialize();
      expect(store.sourceId).toBe("ipfs-env-test");
      expect(store.provider).toBe("ipfs");
    });
  });
});
