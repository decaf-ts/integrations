/**
 * @module integrations/blob/core/value
 * @summary Blob value helpers.
 * @description Utilities for normalizing blob values and collecting them into buffers.
 */
import { getCrypto } from "@decaf-ts/crypto/common";
import { ValidationError } from "@decaf-ts/db-decorators";
import type { BlobValue } from "./BlobTypes";

/**
 * Converts any supported BlobValue into an AsyncIterable of Uint8Array chunks.
 */
export function toAsyncIterable(
  value: BlobValue
): AsyncIterable<Uint8Array> {
  if (value instanceof Uint8Array) {
    return (async function* () {
      yield value;
    })();
  }

  const anyValue = value as any;
  if (anyValue && typeof anyValue[Symbol.asyncIterator] === "function") {
    return anyValue as AsyncIterable<Uint8Array>;
  }

  if (anyValue && typeof anyValue.getReader === "function") {
    return (async function* () {
      const reader = anyValue.getReader();
      try {
        let result = await reader.read();
        while (!result.done) {
          yield result.value as Uint8Array;
          result = await reader.read();
        }
      } finally {
        reader.releaseLock();
      }
    })();
  }

  if (anyValue && typeof anyValue[Symbol.iterator] === "function") {
    return (async function* () {
      for (const chunk of anyValue as Iterable<Uint8Array>) {
        yield chunk;
      }
    })();
  }

  throw new ValidationError(
    `Unsupported blob value type: ${typeof value}`
  );
}

/**
 * Collects an AsyncIterable of Uint8Array chunks into a single Buffer.
 */
export async function collectToBuffer(
  value: BlobValue
): Promise<Buffer> {
  if (value instanceof Uint8Array) {
    return Buffer.from(value);
  }

  const chunks: Buffer[] = [];
  for await (const chunk of toAsyncIterable(value)) {
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

/**
 * Computes the sha256 hex digest of a blob value.
 */
export async function computeSha256(value: BlobValue): Promise<string> {
  const buffer = await collectToBuffer(value);
  const crypto = (await getCrypto()) as any;
  return crypto.createHash("sha256").update(buffer).digest("hex");
}
