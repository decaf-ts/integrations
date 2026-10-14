import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { pathToFileURL } from "url";

import { UnsupportedError } from "@decaf-ts/core";

import { AssetObjectLoader, LoadedAsset } from "../../../src/loader";

describe("AssetObjectLoader", () => {
  let tempDir: string;
  let jsonPath: string;
  let textPath: string;
  let markdownPath: string;
  let imagePath: string;
  let binaryPath: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "decaf-asset-loader-"));
    jsonPath = join(tempDir, "config.json");
    textPath = join(tempDir, "notes.txt");
    markdownPath = join(tempDir, "readme.md");
    imagePath = join(tempDir, "logo.png");
    binaryPath = join(tempDir, "blob.unknownext");

    writeFileSync(jsonPath, JSON.stringify({ name: "app", retries: 3 }), "utf8");
    writeFileSync(textPath, "hello world", "utf8");
    writeFileSync(markdownPath, "# Title", "utf8");
    writeFileSync(imagePath, Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    writeFileSync(binaryPath, Buffer.from([1, 2, 3, 4]));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("auto-encodes a .json asset into a parsed object", async () => {
    const loader = new AssetObjectLoader();
    const asset = await loader.loadAsset<{ name: string; retries: number }>(
      jsonPath
    );

    expect(loader.family).toBe("asset");
    expect(asset.encoding).toBe("json");
    expect(asset.contentType).toBe("application/json");
    expect(asset.extension).toBe(".json");
    expect(asset.name).toBe("config.json");
    expect(asset.path).toBe(jsonPath);
    expect(asset.source).toBe(pathToFileURL(jsonPath).href);
    expect(asset.content).toEqual({ name: "app", retries: 3 });
  });

  it("auto-encodes text assets as utf8 strings", async () => {
    const loader = new AssetObjectLoader();
    const text = await loader.loadText(textPath);
    const markdown = await loader.loadAsset(markdownPath);

    expect(text).toBe("hello world");
    expect(markdown.encoding).toBe("utf8");
    expect(markdown.contentType).toBe("text/markdown");
    expect(markdown.content).toBe("# Title");
  });

  it("auto-encodes image assets as Buffers", async () => {
    const loader = new AssetObjectLoader();
    const asset = await loader.loadAsset<Buffer>(imagePath);

    expect(asset.encoding).toBe("binary");
    expect(asset.contentType).toBe("image/png");
    expect(asset.extension).toBe(".png");
    expect(Buffer.isBuffer(asset.content)).toBe(true);
    expect(asset.content.equals(Buffer.from([0x89, 0x50, 0x4e, 0x47]))).toBe(
      true
    );
  });

  it("defaults unknown extensions to binary", async () => {
    const loader = new AssetObjectLoader();
    const asset = await loader.loadAsset<Buffer>(binaryPath);

    expect(asset.encoding).toBe("binary");
    expect(asset.contentType).toBe("application/octet-stream");
    expect(Buffer.isBuffer(asset.content)).toBe(true);
  });

  it("loadJson returns the parsed content and loadBinary returns a Buffer", async () => {
    const loader = new AssetObjectLoader();

    expect(await loader.loadJson(jsonPath)).toEqual({
      name: "app",
      retries: 3,
    });
    const binary = await loader.loadBinary(imagePath);
    expect(Buffer.isBuffer(binary)).toBe(true);
  });

  it("honours explicit encodings", async () => {
    const loader = new AssetObjectLoader();

    const base64 = await loader.loadAsset<string>(imagePath, {
      encoding: "base64",
    });
    expect(base64.encoding).toBe("base64");
    expect(base64.content).toBe(Buffer.from([0x89, 0x50, 0x4e, 0x47]).toString("base64"));

    const forcedText = await loader.loadText(imagePath, { encoding: "base64" });
    expect(forcedText).toBe(
      Buffer.from([0x89, 0x50, 0x4e, 0x47]).toString("base64")
    );
  });

  it("runs hooks against the LoadedAsset record with asset metadata", async () => {
    const seen: LoadedAsset[] = [];
    let metadata: Readonly<Record<string, unknown>> | undefined;
    let phase: string | undefined;
    const loader = new AssetObjectLoader({
      metadata: { base: true },
      hooks: [
        (value, context) => {
          seen.push(value as LoadedAsset);
          metadata = context.metadata;
          phase = context.phase;
          return { ...(value as LoadedAsset), content: "hooked" };
        },
      ],
    });

    const asset = await loader.loadAsset(textPath);
    expect(seen).toHaveLength(1);
    expect(seen[0].encoding).toBe("utf8");
    expect(asset.content).toBe("hooked");
    expect(metadata).toMatchObject({
      base: true,
      encoding: "utf8",
      contentType: "text/plain",
    });
    expect(phase).toBe("afterResolve");
  });

  it("throws UnsupportedError for non-file URL sources", async () => {
    const loader = new AssetObjectLoader();

    await expect(
      loader.loadAsset("https://example.com/logo.png")
    ).rejects.toBeInstanceOf(UnsupportedError);
    await expect(
      loader.loadAsset(new URL("https://example.com/logo.png"))
    ).rejects.toBeInstanceOf(UnsupportedError);
    await expect(
      loader.loadAsset("http://example.com/logo.png")
    ).rejects.toBeInstanceOf(UnsupportedError);
  });

  it("accepts file: string sources", async () => {
    const loader = new AssetObjectLoader();
    const asset = await loader.loadAsset(pathToFileURL(textPath).href);

    expect(asset.content).toBe("hello world");
    expect(asset.source).toBe(pathToFileURL(textPath).href);
  });
});
