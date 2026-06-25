/**
 * @module integrations/blob/local/service
 * @summary Local filesystem blob store service.
 * @description Filesystem-backed blob store wrapping node:fs with atomic writes and path-traversal protection.
 */
import { type ContextualArgs, ForbiddenError, type MaybeContextualArg, UnsupportedError } from "@decaf-ts/core";
import {
  ConflictError,
  InternalError,
  NotFoundError,
  ValidationError,
} from "@decaf-ts/db-decorators";
import { getCrypto } from "@decaf-ts/crypto/common";
import {
  createReadStream,
  createWriteStream,
  promises as fs,
  type ReadStream,
} from "fs";
import { dirname, join, relative, resolve, sep } from "path";
import { BlobStoreService } from "../core/BlobStoreService";
import type {
  BlobGetOptions,
  BlobGetResult,
  BlobKey,
  BlobListOptions,
  BlobListResult,
  BlobMetadata,
  BlobPutOptions,
  BlobPutResult,
  BlobUrlOptions,
  BlobUrlResult,
  BlobValue,
  LocalBlobStoreServiceConfig,
} from "../core/BlobTypes";

interface LocalFsClient {
  root: string;
}

export class LocalBlobStoreService extends BlobStoreService<
  LocalFsClient,
  LocalBlobStoreServiceConfig
> {
  override async initialize(
    ...args: ContextualArgs<any>
  ): Promise<{
    config: LocalBlobStoreServiceConfig;
    client: LocalFsClient;
  }> {
    const config =
      this.getConfigFromArgs<LocalBlobStoreServiceConfig>(...args);
    if (!config.rootPath) {
      throw new InternalError(
        "LocalBlobStoreService requires a rootPath"
      );
    }
    await fs.mkdir(config.rootPath, { recursive: true });
    this._config = config;
    this._client = { root: resolve(config.rootPath) };
    return { config, client: this._client };
  }

  async put(
    key: BlobKey,
    value: BlobValue,
    options: BlobPutOptions = {},
    ...args: MaybeContextualArg<any>
  ): Promise<BlobPutResult> {
    const { log } = (await this.logCtx(args, "put", true)).for(this.put);
    log.verbose(`Putting blob ${key}`);

    const targetPath = this.safePath(key);

    if (options.ifNotExists) {
      try {
        await fs.stat(targetPath);
        throw new ConflictError(`Blob already exists: ${key}`);
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
      }
    }

    await fs.mkdir(dirname(targetPath), { recursive: true });

    const buffer = await collectToBufferLocal(value);
    const crypto = (await getCrypto()) as any;
    const sha256 = crypto.createHash("sha256").update(buffer).digest("hex");

    if (options.expectedSha256 && options.expectedSha256 !== sha256) {
      throw new ValidationError(`Checksum mismatch for ${key}`);
    }

    await this.atomicWrite(targetPath, buffer);

    const metadata: BlobMetadata = {
      contentType: options.contentType,
      contentLength: buffer.length,
      sha256,
      custom: options.metadata,
    };

    return {
      key,
      uri: this.uri(key, "file"),
      provider: this.provider,
      sourceId: this.sourceId,
      metadata,
    };
  }

  async get(
    key: BlobKey,
    options: BlobGetOptions = {},
    ...args: MaybeContextualArg<any>
  ): Promise<BlobGetResult> {
    const { log } = (await this.logCtx(args, "get", true)).for(this.get);
    log.verbose(`Getting blob ${key}`);

    const targetPath = this.safePath(key);
    const stat = await this.safeStat(targetPath);
    if (!stat) {
      throw new NotFoundError(`Blob not found: ${key}`);
    }

    const stream: ReadStream = createReadStream(targetPath, {
      start: options.range?.start,
      end: options.range?.end,
    });

    const metadata: BlobMetadata = {
      contentLength: stat.size,
    };

    return {
      key,
      value: streamToAsyncIterable(stream),
      uri: this.uri(key, "file"),
      provider: this.provider,
      sourceId: this.sourceId,
      metadata,
    };
  }

  async has(
    key: BlobKey,
    ...args: MaybeContextualArg<any>
  ): Promise<boolean> {
    const { log } = (await this.logCtx(args, "has", true)).for(this.has);
    log.verbose(`Checking blob ${key}`);
    const targetPath = this.safePath(key);
    return Boolean(await this.safeStat(targetPath));
  }

  async stat(
    key: BlobKey,
    ...args: MaybeContextualArg<any>
  ): Promise<BlobMetadata> {
    const { log } = (await this.logCtx(args, "stat", true)).for(this.stat);
    log.verbose(`Statting blob ${key}`);
    const targetPath = this.safePath(key);
    const stat = await this.safeStat(targetPath);
    if (!stat) {
      throw new NotFoundError(`Blob not found: ${key}`);
    }
    return { contentLength: stat.size };
  }

  async delete(
    key: BlobKey,
    ...args: MaybeContextualArg<any>
  ): Promise<void> {
    const { log } = (await this.logCtx(args, "delete", true)).for(this.delete);
    log.verbose(`Deleting blob ${key}`);
    const targetPath = this.safePath(key);
    try {
      await fs.unlink(targetPath);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
    }
  }

  async copy(
    fromKey: BlobKey,
    toKey: BlobKey,
    options: BlobPutOptions = {},
    ...args: MaybeContextualArg<any>
  ): Promise<BlobPutResult> {
    const { log } = (await this.logCtx(args, "copy", true)).for(this.copy);
    log.verbose(`Copying blob ${fromKey} to ${toKey}`);
    const fromPath = this.safePath(fromKey);
    const fromStat = await this.safeStat(fromPath);
    if (!fromStat) {
      throw new NotFoundError(`Blob not found: ${fromKey}`);
    }
    const buffer = await fs.readFile(fromPath);
    return this.put(toKey, buffer, options);
  }

  async list(
    options: BlobListOptions = {},
    ...args: MaybeContextualArg<any>
  ): Promise<BlobListResult> {
    const { log } = (await this.logCtx(args, "list", true)).for(this.list);
    log.verbose("Listing blobs");

    const prefix = options.prefix ? this.physicalKey(options.prefix) : "";
    const root = this.client.root;
    const baseDir = prefix ? join(root, prefix) : root;

    const allFiles: string[] = [];
    await walkDir(baseDir, allFiles);

    const keys = allFiles
      .map((f) => {
        const rel = relative(root, f).split(sep).join("/");
        return prefix ? rel : rel;
      })
      .filter((k) => (prefix ? k.startsWith(prefix) : true))
      .sort();

    const limit = options.limit ?? 1000;
    const startIndex = options.cursor ? Number(options.cursor) : 0;
    const slice = keys.slice(startIndex, startIndex + limit);
    const nextCursor =
      startIndex + limit < keys.length
        ? String(startIndex + limit)
        : undefined;

    return {
      items: slice.map((k) => ({ key: k })),
      cursor: nextCursor,
    };
  }

  async url(
    key: BlobKey,
    options: BlobUrlOptions = {},
    ...args: MaybeContextualArg<any>
  ): Promise<BlobUrlResult> {
    const { log } = (await this.logCtx(args, "url", true)).for(this.url);
    log.verbose(`Building url for blob ${key}`);
    if (options.operation && options.operation !== "get") {
      throw new UnsupportedError("Local blob store does not support PUT urls");
    }
    return {
      url: this.uri(key, "file"),
      method: "GET",
      expiresAt: new Date(
        Date.now() + (options.expiresInSeconds ?? 300) * 1000
      ),
    };
  }

  protected parseError(error: unknown): Error {
    const err = error as Error;
    if (
      err instanceof NotFoundError ||
      err instanceof ConflictError ||
      err instanceof ValidationError ||
      err instanceof InternalError
    ) {
      return err;
    }
    const message = err.message || "Unknown error";
    const lower = message.toLowerCase();
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT" || lower.includes("not found")) {
      return new NotFoundError(err);
    }
    if (code === "EEXIST" || lower.includes("already exists")) {
      return new ConflictError(err);
    }
    if (code === "EACCES" || code === "EPERM" || lower.includes("permission")) {
      return new ForbiddenError(err);
    }
    if (code === "ENAMETOOLONG" || lower.includes("invalid")) {
      return new ValidationError(err);
    }
    return new InternalError(err);
  }

  private safePath(key: BlobKey): string {
    const physical = this.physicalKey(key);
    const root = this.client.root;
    const target = resolve(root, physical);
    const rel = relative(root, target);
    if (rel.startsWith("..") || rel === "" || rel === "." || rel.startsWith(`..${sep}`)) {
      throw new ValidationError(`Blob key escapes root path: ${key}`);
    }
    return target;
  }

  private async safeStat(
    path: string
  ): Promise<{ size: number } | undefined> {
    try {
      const stat = await fs.stat(path);
      if (stat.isFile()) return { size: stat.size };
      return undefined;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") return undefined;
      throw e;
    }
  }

  private async atomicWrite(targetPath: string, buffer: Buffer): Promise<void> {
    const crypto = (await getCrypto()) as any;
    const tmpPath = `${targetPath}.${crypto.randomBytes(6).toString("hex")}.tmp`;
    const stream = createWriteStream(tmpPath);
    await new Promise<void>((resolve, reject) => {
      stream.on("error", reject);
      stream.on("finish", () => resolve());
      stream.end(buffer);
    });
    try {
      await fs.rename(tmpPath, targetPath);
    } catch (e) {
      try {
        await fs.unlink(tmpPath);
      } catch {
        /* ignore */
      }
      throw e;
    }
  }
}

async function collectToBufferLocal(value: BlobValue): Promise<Buffer> {
  if (value instanceof Uint8Array) return Buffer.from(value);
  if (value instanceof Buffer) return value;
  if (typeof (value as any)?.[Symbol.asyncIterator] === "function") {
    const chunks: Buffer[] = [];
    for await (const chunk of value as AsyncIterable<Uint8Array>) {
      chunks.push(Buffer.from(chunk));
    }
    return Buffer.concat(chunks);
  }
  if (typeof (value as any)?.getReader === "function") {
    const reader = (value as ReadableStream).getReader();
    const chunks: Buffer[] = [];
    let result = await reader.read();
    while (!result.done) {
      chunks.push(Buffer.from(result.value as Uint8Array));
      result = await reader.read();
    }
    return Buffer.concat(chunks);
  }
  throw new ValidationError(`Unsupported blob value type: ${typeof value}`);
}

async function* streamToAsyncIterable(
  stream: ReadStream
): AsyncIterable<Uint8Array> {
  for await (const chunk of stream) {
    yield chunk as Uint8Array;
  }
}

async function walkDir(dir: string, acc: string[]): Promise<void> {
  let entries: string[];
  try {
    entries = await fs.readdir(dir);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return;
    throw e;
  }
  for (const entry of entries) {
    if (entry.endsWith(".tmp")) continue;
    const full = join(dir, entry);
    const stat = await fs.stat(full);
    if (stat.isDirectory()) {
      await walkDir(full, acc);
    } else {
      acc.push(full);
    }
  }
}
