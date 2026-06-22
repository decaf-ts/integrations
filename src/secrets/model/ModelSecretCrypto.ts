// @ts-expect-error - crypto is a peer dependency with exports field
import { getCrypto, getSubtle } from "@decaf-ts/crypto/integration";
import { InternalError } from "@decaf-ts/db-decorators";
import type { SecretEncryptionMetadata } from "./Secret";

const ALGORITHM = { name: "AES-GCM", length: 256 };
const IV_LENGTH = 12;

export async function encryptPayload(
  payload: string,
  keyId: string,
  key: string
): Promise<{ encryptedData: string; metadata: SecretEncryptionMetadata }> {
  try {
    const crypto = (await getCrypto()) as any;
    const subtle = await getSubtle();

    const salt = crypto.randomBytes(IV_LENGTH);
    const keyBuffer = Buffer.from(key, "base64");
    const importedKey = await subtle.importKey(
      "raw",
      keyBuffer,
      ALGORITHM,
      false,
      ["encrypt"]
    );

    const encoder = new TextEncoder();
    const data = encoder.encode(payload);
    const encryptedBuffer = await subtle.encrypt(
      {
        ...ALGORITHM,
        iv: salt,
      },
      importedKey,
      data
    );

    const encryptedBytes = new Uint8Array(encryptedBuffer);
    const combined = new Uint8Array(IV_LENGTH + encryptedBytes.length);
    combined.set(salt);
    combined.set(encryptedBytes, IV_LENGTH);

    return {
      encryptedData: Buffer.from(combined).toString("base64"),
      metadata: {
        keyId,
        iv: salt.toString("base64"),
      },
    };
  } catch (error) {
    throw new InternalError(
      `Failed to encrypt payload: ${(error as Error).message}`
    );
  }
}

export async function decryptPayload(
  encryptedData: string,
  key: string
): Promise<string> {
  try {
    const subtle = await getSubtle();

    const combined = Buffer.from(encryptedData, "base64");
    const iv = combined.slice(0, IV_LENGTH);
    const cipherText = combined.slice(IV_LENGTH);

    const keyBuffer = Buffer.from(key, "base64");
    const importedKey = await subtle.importKey(
      "raw",
      keyBuffer,
      ALGORITHM,
      false,
      ["decrypt"]
    );

    const decryptedBuffer = await subtle.decrypt(
      {
        ...ALGORITHM,
        iv: iv,
      },
      importedKey,
      cipherText
    );

    const decoder = new TextDecoder();
    return decoder.decode(decryptedBuffer);
  } catch (error) {
    throw new InternalError(
      `Failed to decrypt payload: ${(error as Error).message}`
    );
  }
}

export async function deriveKeyFromSecret(
  secret: string,
  salt?: string
): Promise<string> {
  try {
    const crypto = (await getCrypto()) as any;
    const saltBuffer = salt
      ? Buffer.from(salt, "base64")
      : crypto.randomBytes(16);
    const key = crypto.pbkdf2Sync(secret, saltBuffer, 100_000, 32, "sha256");
    return Buffer.concat([saltBuffer, key]).toString("base64");
  } catch (error) {
    throw new InternalError(
      `Failed to derive key: ${(error as Error).message}`
    );
  }
}

export function extractKeyFromDerivedKey(derivedKey: string): {
  salt: string;
  key: string;
} {
  const buffer = Buffer.from(derivedKey, "base64");
  const salt = buffer.slice(0, 16).toString("base64");
  const key = buffer.slice(16).toString("base64");
  return { salt, key };
}
