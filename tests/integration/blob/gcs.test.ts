import path from "path";
import { GcsBlobStoreService } from "../../../src/blob/gcp/GcsBlobStoreService";
import { collectToBuffer } from "../../../src/blob/core/BlobValue";
import { DockerComposeService } from "../../../src/docker";

const composeFile = path.resolve(
  import.meta.dirname,
  "../../../docker/gcs-blob-compose.yml"
);
const workingDir = path.dirname(composeFile);

let dockerService: DockerComposeService;
let gcsStore: GcsBlobStoreService;

const bucket = "decaf-blob-integration";

describe("GCS Blob Store Integration Tests", () => {
  beforeAll(async () => {
    dockerService = new DockerComposeService();
    await dockerService.initialize({ composeFile, workingDir });
    await dockerService.up();
    await dockerService.waitForHealth("http://localhost:4443/", {
      requireOk: false,
    });

    gcsStore = new GcsBlobStoreService();
    await gcsStore.initialize({
      provider: "gcs",
      sourceId: "fake-gcs-integration",
      bucket,
      apiEndpoint: "http://localhost:4443",
      projectId: "test-project",
    });

    // fake-gcs-server requires the bucket to exist before writes.
    await gcsStore.client.create({ ignoreExisting: true });
  }, 120000);

  afterAll(async () => {
    await dockerService.down();
  }, 120000);

  it("puts and gets a blob", async () => {
    const key = "docs/readme.txt";
    const payload = Buffer.from("gcs blob content");

    const result = await gcsStore.put(key, payload, {
      contentType: "text/plain",
    });
    expect(result.provider).toBe("gcs");

    const got = await gcsStore.get(key);
    const collected = await collectToBuffer(got.value);
    expect(collected.toString()).toBe("gcs blob content");
  });

  it("checks existence and stat", async () => {
    const key = "data/check.bin";
    await gcsStore.put(key, Buffer.from([0, 1, 2, 3]));
    expect(await gcsStore.has(key)).toBe(true);
    const stat = await gcsStore.stat(key);
    expect(stat.contentLength).toBe(4);
  });

  it("copies a blob", async () => {
    const from = "copy/from.txt";
    const to = "copy/to.txt";
    await gcsStore.put(from, Buffer.from("copy me"));
    await gcsStore.copy(from, to);
    const got = await gcsStore.get(to);
    expect((await collectToBuffer(got.value)).toString()).toBe("copy me");
  });

  it("lists blobs with a prefix", async () => {
    await gcsStore.put("list/a.txt", Buffer.from("a"));
    await gcsStore.put("list/b.txt", Buffer.from("b"));
    const list = await gcsStore.list({ prefix: "list/" });
    const keys = list.items.map((i) => i.key);
    expect(keys).toContain("list/a.txt");
    expect(keys).toContain("list/b.txt");
  });

  it("deletes a blob", async () => {
    const key = "del/target.txt";
    await gcsStore.put(key, Buffer.from("bye"));
    await gcsStore.delete(key);
    expect(await gcsStore.has(key)).toBe(false);
  });

  it("honors ifNotExists", async () => {
    const key = "lock/once.txt";
    await gcsStore.put(key, Buffer.from("first"));
    await expect(
      gcsStore.put(key, Buffer.from("second"), { ifNotExists: true })
    ).rejects.toThrow();
  });
});
