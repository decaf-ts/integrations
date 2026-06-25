import os from "os";
import path from "path";
import { rm } from "fs/promises";
import {
  ConflictError,
  NotFoundError,
  translateBlobError,
  UnsupportedError,
  ValidationError,
} from "../../../src/blob/core/BlobErrors";
import { cleanKey, physicalKey } from "../../../src/blob/core/BlobKey";
import { collectToBuffer, computeSha256, toAsyncIterable } from "../../../src/blob/core/BlobValue";
import { BlobStoreFactory } from "../../../src/blob/core/BlobStoreFactory";
import { MemoryBlobStoreService } from "../../../src/blob/memory/MemoryBlobStoreService";
import { LocalBlobStoreService } from "../../../src/blob/local/LocalBlobStoreService";
import type { BlobStoreService } from "../../../src/blob/core/BlobStoreService";

async function drain(value: AsyncIterable<Uint8Array>): Promise<Buffer> {
  return collectToBuffer(value);
}

describe("Blob core utilities", () => {
  describe("cleanKey / physicalKey", () => {
    it("strips leading slashes", () => {
      expect(cleanKey("/a/b/c")).toBe("a/b/c");
      expect(cleanKey("///a")).toBe("a");
    });

    it("rejects unsafe segments", () => {
      expect(() => cleanKey("")).toThrow(ValidationError);
      expect(() => cleanKey(".")).toThrow(ValidationError);
      expect(() => cleanKey("..")).toThrow(ValidationError);
      expect(() => cleanKey("../etc/passwd")).toThrow(ValidationError);
      expect(() => cleanKey("a/../../b")).toThrow(ValidationError);
    });

    it("applies a trimmed prefix", () => {
      expect(physicalKey("o1", "tenants/acme/")).toBe("tenants/acme/o1");
      expect(physicalKey("/o1", "/tenants/acme")).toBe("tenants/acme/o1");
      expect(physicalKey("o1")).toBe("o1");
    });
  });

  describe("BlobValue helpers", () => {
    it("converts Uint8Array to async iterable and back", async () => {
      const data = new Uint8Array([1, 2, 3]);
      const buffer = await drain(toAsyncIterable(data));
      expect(buffer).toEqual(Buffer.from([1, 2, 3]));
    });

    it("collects a multi-chunk async iterable", async () => {
      async function* gen() {
        yield new Uint8Array([1, 2]);
        yield new Uint8Array([3, 4]);
      }
      const buffer = await collectToBuffer(gen());
      expect(buffer).toEqual(Buffer.from([1, 2, 3, 4]));
    });

    it("computes sha256", async () => {
      const sha = await computeSha256(new Uint8Array([1, 2, 3]));
      expect(sha).toMatch(/^[0-9a-f]{64}$/);
    });
  });

  describe("Error translation", () => {
    it("translateBlobError maps not found", () => {
      const translated = translateBlobError(new Error("Blob not found"));
      expect(translated).toBeInstanceOf(NotFoundError);
    });

    it("translateBlobError maps already exists", () => {
      const translated = translateBlobError(new Error("Blob already exists"));
      expect(translated).toBeInstanceOf(ConflictError);
    });

    it("translateBlobError passes through DECAF errors", () => {
      const original = new NotFoundError("already a decaf error");
      const translated = translateBlobError(original);
      expect(translated).toBe(original);
    });
  });
});

async function exerciseStoreContract(
  store: BlobStoreService,
  label: string
): Promise<void> {
  const key = `${label}/o1/v1/original.txt`;
  const bytes = Buffer.from("hello blob world");

  await store.put(key, bytes, { contentType: "text/plain" });
  expect(await store.has(key)).toBe(true);

  const stat = await store.stat(key);
  expect(stat.contentLength).toBe(bytes.length);

  const got = await store.get(key);
  const collected = await drain(got.value);
  expect(collected.toString()).toBe("hello blob world");
  expect(got.provider).toBe(store.provider);
  expect(got.sourceId).toBe(store.sourceId);

  const copyKey = `${label}/o1/v2/copy.txt`;
  await store.copy(key, copyKey);
  expect(await store.has(copyKey)).toBe(true);
  const copyGot = await store.get(copyKey);
  expect((await drain(copyGot.value)).toString()).toBe("hello blob world");

  const list = await store.list({ prefix: `${label}/o1` });
  expect(list.items.length).toBe(2);
  expect(list.items.map((i) => i.key).sort()).toEqual(
    [copyKey, key].sort()
  );

  await store.delete(key);
  expect(await store.has(key)).toBe(false);

  await store.delete(copyKey);
}

describe("MemoryBlobStoreService contract", () => {
  let store: MemoryBlobStoreService;

  beforeEach(async () => {
    store = new MemoryBlobStoreService();
    await store.initialize({
      provider: "memory",
      sourceId: "memory-test",
    });
  });

  it("runs the full CRUD contract", async () => {
    await exerciseStoreContract(store, "contract");
  });

  it("applies a configured prefix to physical keys", async () => {
    const prefixed = new MemoryBlobStoreService();
    await prefixed.initialize({
      provider: "memory",
      sourceId: "memory-prefixed",
      prefix: "tenant/acme",
    });
    await prefixed.put("doc.txt", Buffer.from("x"));
    const list = await prefixed.list();
    expect(list.items[0].key).toBe("tenant/acme/doc.txt");
  });

  it("honors ifNotExists", async () => {
    await store.put("lock.txt", Buffer.from("a"));
    await expect(
      store.put("lock.txt", Buffer.from("b"), { ifNotExists: true })
    ).rejects.toThrow(ConflictError);
  });

  it("validates expectedSha256", async () => {
    await expect(
      store.put("k", Buffer.from("a"), { expectedSha256: "deadbeef" })
    ).rejects.toThrow(ValidationError);
  });

  it("returns a GET url", async () => {
    const res = await store.url("k");
    expect(res.method).toBe("GET");
    expect(res.url).toContain("memory://");
  });

  it("rejects PUT urls", async () => {
    await expect(store.url("k", { operation: "put" })).rejects.toThrow(
      UnsupportedError
    );
  });
});

describe("LocalBlobStoreService contract", () => {
  let store: LocalBlobStoreService;
  let root: string;

  beforeEach(async () => {
    root = path.join(os.tmpdir(), `decaf-blob-test-${Date.now()}`);
    store = new LocalBlobStoreService();
    await store.initialize({
      provider: "local",
      sourceId: "local-test",
      rootPath: root,
    });
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("runs the full CRUD contract", async () => {
    await exerciseStoreContract(store, "contract");
  });

  it("rejects keys that escape the root path", async () => {
    await expect(
      store.put("../../../../etc/passwd", Buffer.from("x"))
    ).rejects.toThrow();
  });

  it("reports has=false for missing blobs", async () => {
    expect(await store.has("missing")).toBe(false);
    await expect(store.stat("missing")).rejects.toThrow();
  });
});

describe("BlobStoreFactory", () => {
  it("creates a memory store via factory", async () => {
    const factory = new BlobStoreFactory();
    const store = factory.create({
      provider: "memory",
      sourceId: "factory-test",
    });
    await store.initialize({ provider: "memory", sourceId: "factory-test" });
    await store.put("k", Buffer.from("v"));
    expect(await store.has("k")).toBe(true);
  });

  it("throws on unsupported provider", async () => {
    const factory = new BlobStoreFactory();
    expect(() =>
      factory.create({ provider: "unsupported" as any, sourceId: "x" })
    ).toThrow();
  });
});
