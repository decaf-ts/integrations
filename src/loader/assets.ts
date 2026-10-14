import { readFile } from "node:fs/promises";
import { basename, extname, isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { UnsupportedError } from "@decaf-ts/core";

import { ObjectLoader } from "./ObjectLoader";
import type {
  ObjectLoaderLoadOptions,
  ObjectLoaderOptions,
  ObjectLoaderSource,
} from "./types";

export type AssetEncoding = "utf8" | "binary" | "base64" | "json" | "auto";

export interface LoadedAsset<T = unknown> {
  /** Normalized source used to locate the asset. */
  readonly source: string;
  /** Resolved filesystem path. */
  readonly path: string;
  /** File name including extension. */
  readonly name: string;
  /** Lower-cased file extension (e.g. `.json`). */
  readonly extension: string;
  /** Encoding used to decode the content. */
  readonly encoding: Exclude<AssetEncoding, "auto">;
  /** Best-effort content type derived from the extension. */
  readonly contentType: string;
  /** Decoded content. */
  readonly content: T;
}

export interface AssetLoadOptions extends ObjectLoaderLoadOptions {
  readonly encoding?: AssetEncoding;
}

const TEXT_EXTENSIONS = new Set([
  ".txt",
  ".md",
  ".csv",
  ".html",
  ".htm",
  ".xml",
  ".yaml",
  ".yml",
  ".graphql",
  ".sql",
]);

const IMAGE_EXTENSIONS = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".bmp",
  ".ico",
  ".avif",
  ".tiff",
]);

const CONTENT_TYPES: Record<string, string> = {
  ".json": "application/json",
  ".txt": "text/plain",
  ".md": "text/markdown",
  ".csv": "text/csv",
  ".html": "text/html",
  ".htm": "text/html",
  ".xml": "application/xml",
  ".yaml": "application/yaml",
  ".yml": "application/yaml",
  ".sql": "application/sql",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".bmp": "image/bmp",
  ".ico": "image/x-icon",
  ".avif": "image/avif",
  ".tiff": "image/tiff",
};

function contentTypeFor(extension: string): string {
  return CONTENT_TYPES[extension] ?? "application/octet-stream";
}

/**
 * @summary Load asset files as content instead of importing a class.
 * @description Assets (locale files, images, templates, ...) are *not* modules;
 * they are read from disk and decoded. Hooks run on the {@link LoadedAsset}
 * record so callers can inspect or replace content before it enters the system.
 *
 * A `"json"` encoding parses the file content, `"utf8"` returns text,
 * `"base64"` returns a base64 string, and `"binary"` returns the raw
 * `Buffer`. `"auto"` picks `json` for `.json`, `utf8` for known text
 * extensions, and `binary` otherwise.
 */
export class AssetObjectLoader extends ObjectLoader {
  public constructor(options: ObjectLoaderOptions = {}) {
    super({ ...options, family: "asset" });
  }

  public async loadAsset<T = unknown>(
    source: ObjectLoaderSource,
    options: AssetLoadOptions = {}
  ): Promise<LoadedAsset<T>> {
    const path = this.toFilePath(source);
    const name = basename(path);
    const extension = extname(path).toLowerCase();
    const encoding = this.resolveEncoding(
      extension,
      options.encoding ?? "auto"
    );
    const buffer = await readFile(path);
    const content = this.decode<T>(buffer, encoding);
    const asset: LoadedAsset<T> = {
      source: this.normalizeSource(source),
      path,
      name,
      extension,
      encoding,
      contentType: contentTypeFor(extension),
      content,
    };
    const context = this.createContext(asset.source, name, {}, "afterResolve", {
      ...this.metadata,
      ...(options.metadata ?? {}),
      encoding,
      contentType: asset.contentType,
    });
    return this.runHooks(asset, context, options);
  }

  public async loadText(
    source: ObjectLoaderSource,
    options: AssetLoadOptions = {}
  ): Promise<string> {
    const asset = await this.loadAsset<string>(source, {
      ...options,
      encoding:
        options.encoding && options.encoding !== "auto"
          ? options.encoding
          : "utf8",
    });
    return asset.content;
  }

  public async loadJson<T = unknown>(
    source: ObjectLoaderSource,
    options: AssetLoadOptions = {}
  ): Promise<T> {
    const asset = await this.loadAsset<T>(source, {
      ...options,
      encoding: "json",
    });
    return asset.content;
  }

  public async loadBinary(
    source: ObjectLoaderSource,
    options: AssetLoadOptions = {}
  ): Promise<Buffer> {
    const asset = await this.loadAsset<Buffer>(source, {
      ...options,
      encoding: "binary",
    });
    return asset.content;
  }

  protected resolveEncoding(
    extension: string,
    requested: AssetEncoding
  ): Exclude<AssetEncoding, "auto"> {
    if (requested !== "auto") return requested;
    if (extension === ".json") return "json";
    if (TEXT_EXTENSIONS.has(extension)) return "utf8";
    if (IMAGE_EXTENSIONS.has(extension)) return "binary";
    return "binary";
  }

  protected decode<T>(
    buffer: Buffer,
    encoding: Exclude<AssetEncoding, "auto">
  ): T {
    switch (encoding) {
      case "json":
        return JSON.parse(buffer.toString("utf8")) as T;
      case "base64":
        return buffer.toString("base64") as unknown as T;
      case "binary":
        return buffer as unknown as T;
      case "utf8":
      default:
        return buffer.toString("utf8") as unknown as T;
    }
  }

  protected toFilePath(source: ObjectLoaderSource): string {
    if (source instanceof URL) {
      if (source.protocol !== "file:") {
        throw new UnsupportedError(
          `AssetObjectLoader only supports local file sources, received "${source.href}".`
        );
      }
      return fileURLToPath(source);
    }

    if (source.startsWith("file:")) {
      return fileURLToPath(source);
    }

    if (/^[a-z][a-z0-9+.-]*:\/\//i.test(source)) {
      throw new UnsupportedError(
        `AssetObjectLoader only supports local file sources, received "${source}".`
      );
    }

    return isAbsolute(source) ? source : resolve(source);
  }
}
