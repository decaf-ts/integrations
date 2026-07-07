import path from "path";
import { fileURLToPath } from "url";
import { AzureBlobStoreService } from "../../../src/blob/azure/AzureBlobStoreService";
import { collectToBuffer } from "../../../src/blob/core/BlobValue";
import { DockerComposeService } from "../../../src/docker";

const testDirname = path.dirname(fileURLToPath(import.meta.url));
const composeFile = path.resolve(
  testDirname,
  "../../../docker/azure-blob-compose.yml"
);
const workingDir = path.dirname(composeFile);

let dockerService: DockerComposeService;
let azureStore: AzureBlobStoreService;

// Azurite well-known development connection string
const connectionString =
  "DefaultEndpointsProtocol=http;AccountName=devstoreaccount1;AccountKey=Eby8vdM02xNOcqFlqUwJPLlmEtlCDXJ1OUzFT50uSRZ6IFsuFq2UVErCz4I6tq/K1SZFPTOtr/KBHBeksoGMGw==;BlobEndpoint=http://localhost:10000/devstoreaccount1;";

const container = "decaf-blob-integration";

describe("Azure Blob Store Integration Tests", () => {
  beforeAll(async () => {
    dockerService = new DockerComposeService();
    await dockerService.initialize({ composeFile, workingDir });
    await dockerService.up();
    await dockerService.waitForHealth("http://localhost:10000/", {
      requireOk: false,
    });

    azureStore = new AzureBlobStoreService();
    await azureStore.initialize({
      provider: "azure-blob",
      sourceId: "azurite-integration",
      connectionString,
      container,
    });

    // Azurite does not auto-create containers via the service; create it once.
    await azureStore.client.createIfNotExists();
  }, 120000);

  afterAll(async () => {
    await dockerService.down();
  }, 120000);

  it("puts and gets a blob", async () => {
    const key = "docs/readme.txt";
    const payload = Buffer.from("azure blob content");

    const result = await azureStore.put(key, payload, {
      contentType: "text/plain",
    });
    expect(result.provider).toBe("azure-blob");

    const got = await azureStore.get(key);
    const collected = await collectToBuffer(got.value);
    expect(collected.toString()).toBe("azure blob content");
  });

  it("checks existence and stat", async () => {
    const key = "data/check.bin";
    await azureStore.put(key, Buffer.from([0, 1, 2, 3, 4]));
    expect(await azureStore.has(key)).toBe(true);
    const stat = await azureStore.stat(key);
    expect(stat.contentLength).toBe(5);
  });

  it("copies a blob", async () => {
    const from = "copy/from.txt";
    const to = "copy/to.txt";
    await azureStore.put(from, Buffer.from("copy me"));
    await azureStore.copy(from, to);
    const got = await azureStore.get(to);
    expect((await collectToBuffer(got.value)).toString()).toBe("copy me");
  });

  it("lists blobs with a prefix", async () => {
    await azureStore.put("list/a.txt", Buffer.from("a"));
    await azureStore.put("list/b.txt", Buffer.from("b"));
    const list = await azureStore.list({ prefix: "list/" });
    const keys = list.items.map((i) => i.key);
    expect(keys).toContain("list/a.txt");
    expect(keys).toContain("list/b.txt");
  });

  it("deletes a blob", async () => {
    const key = "del/target.txt";
    await azureStore.put(key, Buffer.from("bye"));
    await azureStore.delete(key);
    expect(await azureStore.has(key)).toBe(false);
  });

  it("honors ifNotExists", async () => {
    const key = "lock/once.txt";
    await azureStore.put(key, Buffer.from("first"));
    await expect(
      azureStore.put(key, Buffer.from("second"), { ifNotExists: true })
    ).rejects.toThrow();
  });
});
