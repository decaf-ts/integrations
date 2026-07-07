import path from "path";
import { fileURLToPath } from "url";
import { IpfsBlobStoreService } from "../../../src/blob/ipfs/IpfsBlobStoreService";
import { collectToBuffer } from "../../../src/blob/core/BlobValue";
import { DockerComposeService } from "../../../src/docker";

const testDirname = path.dirname(fileURLToPath(import.meta.url));
const composeFile = path.resolve(testDirname, "../../../docker/ipfs-compose.yml");
const workingDir = path.dirname(composeFile);

let dockerService: DockerComposeService;
let ipfsStore: IpfsBlobStoreService;

describe("IPFS Blob Store Integration Tests", () => {
  beforeAll(async () => {
    dockerService = new DockerComposeService();
    await dockerService.initialize({ composeFile, workingDir });
    await dockerService.up();
    await dockerService.waitForHealth("http://localhost:5001/api/v0/version", {
      requireOk: false,
    });

    ipfsStore = new IpfsBlobStoreService();
    await ipfsStore.initialize({
      provider: "ipfs",
      sourceId: "kubo-integration",
      apiUrl: "http://localhost:5001",
      gatewayUrl: "http://localhost:8080",
      pinByDefault: true,
      keyIndex: { provider: "memory" },
    });
  }, 120000);

  afterAll(async () => {
    await dockerService.down();
  }, 120000);

  it("puts and gets a blob", async () => {
    const key = "docs/readme.txt";
    const payload = Buffer.from("ipfs blob content");

    const result = await ipfsStore.put(key, payload, {
      contentType: "text/plain",
    });
    expect(result.provider).toBe("ipfs");
    expect(result.uri).toMatch(/^ipfs:\/\/.+/);
    expect(result.metadata.cid).toBeDefined();

    const got = await ipfsStore.get(key);
    const collected = await collectToBuffer(got.value);
    expect(collected.toString()).toBe("ipfs blob content");
    expect(got.metadata.cid).toBe(result.metadata.cid);
  });

  it("checks existence and stat", async () => {
    const key = "data/check.bin";
    await ipfsStore.put(key, Buffer.from([0, 1, 2, 3]));
    expect(await ipfsStore.has(key)).toBe(true);
    expect(await ipfsStore.has("data/missing.bin")).toBe(false);
    const stat = await ipfsStore.stat(key);
    expect(stat.cid).toBeDefined();
  });

  it("copies a blob", async () => {
    const from = "copy/from.txt";
    const to = "copy/to.txt";
    await ipfsStore.put(from, Buffer.from("copy me"));
    await ipfsStore.copy(from, to);
    const got = await ipfsStore.get(to);
    expect((await collectToBuffer(got.value)).toString()).toBe("copy me");
  });

  it("lists blobs with a prefix", async () => {
    await ipfsStore.put("list/a.txt", Buffer.from("a"));
    await ipfsStore.put("list/b.txt", Buffer.from("b"));
    const list = await ipfsStore.list({ prefix: "list/" });
    const keys = list.items.map((i) => i.key);
    expect(keys).toContain("list/a.txt");
    expect(keys).toContain("list/b.txt");
  });

  it("deletes a blob (unpins and removes the index entry)", async () => {
    const key = "del/target.txt";
    await ipfsStore.put(key, Buffer.from("bye"));
    await ipfsStore.delete(key);
    expect(await ipfsStore.has(key)).toBe(false);
  });

  it("honors ifNotExists", async () => {
    const key = "lock/once.txt";
    await ipfsStore.put(key, Buffer.from("first"));
    await expect(
      ipfsStore.put(key, Buffer.from("second"), { ifNotExists: true })
    ).rejects.toThrow();
  });

  it("builds a gateway url", async () => {
    const key = "gw/lookup.txt";
    await ipfsStore.put(key, Buffer.from("gateway"));
    const res = await ipfsStore.url(key);
    expect(res.method).toBe("GET");
    expect(res.url).toContain("http://localhost:8080/ipfs/");
  });
});
