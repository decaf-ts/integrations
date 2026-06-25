import path from "path";
import { MinioBlobStoreService } from "../../../src/blob/s3/MinioBlobStoreService";
import { S3BlobStoreService } from "../../../src/blob/s3/S3BlobStoreService";
import { collectToBuffer } from "../../../src/blob/core/BlobValue";
import { DockerComposeService } from "../../../src/docker";

const composeFile = path.resolve(import.meta.dirname, "../../../docker/minio-compose.yml");
const workingDir = path.dirname(composeFile);

let dockerService: DockerComposeService;
let s3Store: S3BlobStoreService;
let minioStore: MinioBlobStoreService;

const bucket = "decaf-blob-integration";

const baseConfig = {
  sourceId: "minio-integration",
  endpoint: "http://localhost:9100",
  region: "us-east-1",
  bucket,
  forcePathStyle: true,
  credentials: {
    accessKeyId: "minioadmin",
    secretAccessKey: "minioadmin",
  },
};

describe("S3/MinIO Blob Store Integration Tests", () => {
  beforeAll(async () => {
    dockerService = new DockerComposeService();
    await dockerService.initialize({ composeFile, workingDir });
    await dockerService.up();
    await dockerService.waitForHealth(
      "http://localhost:9100/minio/health/ready"
    );

    s3Store = new S3BlobStoreService();
    await s3Store.initialize({
      ...baseConfig,
      provider: "s3",
      autoCreateBucket: true,
    });

    minioStore = new MinioBlobStoreService();
    await minioStore.initialize({
      ...baseConfig,
      sourceId: "minio-instance",
      provider: "minio",
    });
  }, 120000);

  afterAll(async () => {
    await dockerService.down();
  }, 120000);

  it("puts and gets a blob", async () => {
    const key = "docs/readme.txt";
    const payload = Buffer.from("integration blob content");

    const result = await s3Store.put(key, payload, {
      contentType: "text/plain",
    });
    expect(result.provider).toBe("s3");
    expect(result.metadata.contentLength).toBe(payload.length);

    const got = await s3Store.get(key);
    const collected = await collectToBuffer(got.value);
    expect(collected.toString()).toBe("integration blob content");
    expect(got.metadata.contentType).toBe("text/plain");
  });

  it("checks existence and stat", async () => {
    const key = "data/check.bin";
    await s3Store.put(key, Buffer.from([0, 1, 2, 3]));
    expect(await s3Store.has(key)).toBe(true);
    expect(await s3Store.has("data/missing.bin")).toBe(false);
    const stat = await s3Store.stat(key);
    expect(stat.contentLength).toBe(4);
  });

  it("copies a blob", async () => {
    const from = "copy/from.txt";
    const to = "copy/to.txt";
    await s3Store.put(from, Buffer.from("copy me"));
    await s3Store.copy(from, to);
    const got = await s3Store.get(to);
    expect((await collectToBuffer(got.value)).toString()).toBe("copy me");
  });

  it("lists blobs with a prefix", async () => {
    await s3Store.put("list/a.txt", Buffer.from("a"));
    await s3Store.put("list/b.txt", Buffer.from("b"));
    const list = await s3Store.list({ prefix: "list/" });
    const keys = list.items.map((i) => i.key);
    expect(keys).toContain("list/a.txt");
    expect(keys).toContain("list/b.txt");
  });

  it("deletes a blob", async () => {
    const key = "del/target.txt";
    await s3Store.put(key, Buffer.from("bye"));
    await s3Store.delete(key);
    expect(await s3Store.has(key)).toBe(false);
  });

  it("honors ifNotExists", async () => {
    const key = "lock/once.txt";
    await s3Store.put(key, Buffer.from("first"));
    await expect(
      s3Store.put(key, Buffer.from("second"), { ifNotExists: true })
    ).rejects.toThrow();
  });

  it("generates a presigned GET url", async () => {
    const key = "presign/get.txt";
    await s3Store.put(key, Buffer.from("signed"));
    const res = await s3Store.url(key, { expiresInSeconds: 60 });
    expect(res.method).toBe("GET");
    expect(res.url).toContain("http");
    const response = await fetch(res.url);
    expect(response.ok).toBe(true);
    expect(await response.text()).toBe("signed");
  });

  it("generates a presigned PUT url", async () => {
    const key = "presign/put.txt";
    const res = await s3Store.url(key, {
      operation: "put",
      expiresInSeconds: 60,
      contentType: "text/plain",
    });
    expect(res.method).toBe("PUT");
    const response = await fetch(res.url, {
      method: "PUT",
      body: "uploaded-via-presign",
      headers: { "Content-Type": "text/plain" },
    });
    expect(response.ok).toBe(true);
    const got = await s3Store.get(key);
    expect((await collectToBuffer(got.value)).toString()).toBe(
      "uploaded-via-presign"
    );
  });

  it("uses the minio-branded service against the same bucket", async () => {
    const key = "minio/branded.txt";
    await minioStore.put(key, Buffer.from("minio works"));
    expect(await minioStore.has(key)).toBe(true);
    expect(await s3Store.has(key)).toBe(true);
  });

  it("rejects not-found errors", async () => {
    await expect(s3Store.get("does/not/exist")).rejects.toThrow();
    await expect(s3Store.stat("does/not/exist")).rejects.toThrow();
  });
});
