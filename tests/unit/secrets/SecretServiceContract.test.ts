import { SecretError } from "../../../src/secrets/core/SecretErrors";
import { validateSecretName, normalizeSecretName } from "../../../src/secrets/core/SecretName";
import { serializeSecretPayload, deserializeSecretPayload } from "../../../src/secrets/core/SecretSerialization";

describe("SecretService Core Utilities", () => {
  describe("SecretName validation", () => {
    it("validates valid secret names", () => {
      expect(validateSecretName("valid-name")).toBe(true);
      expect(validateSecretName("valid_name_123")).toBe(true);
      expect(validateSecretName("a".repeat(100))).toBe(true);
    });

    it("rejects empty names", () => {
      expect(validateSecretName("")).toBe(false);
      expect(validateSecretName("   ")).toBe(false);
    });

    it("rejects names with control characters", () => {
      expect(validateSecretName("test\nname")).toBe(false);
      expect(validateSecretName("test\0name")).toBe(false);
    });

    it("rejects names with ..", () => {
      expect(validateSecretName("../etc/passwd")).toBe(false);
    });

    it("normalizes secret names", () => {
      expect(normalizeSecretName("  test  ")).toBe("test");
      expect(normalizeSecretName("Test_Name-123")).toBe("Test_Name-123");
    });

    it("throws on invalid names in normalizeSecretName", () => {
      expect(() => normalizeSecretName("")).toThrow(SecretError);
      expect(() => normalizeSecretName("invalid name")).toThrow(SecretError);
    });
  });

  describe("SecretPayload serialization", () => {
    it("serializes string payloads", () => {
      const result = serializeSecretPayload("test-value");
      expect(result.encoding).toBe("utf8");
      expect(result.value).toBe("test-value");
    });

    it("serializes JSON payloads", () => {
      const payload = { key: "value", nested: { foo: "bar" } };
      const result = serializeSecretPayload(payload);
      expect(result.encoding).toBe("json");
      expect(JSON.parse(result.value)).toEqual(payload);
    });

    it("serializes Uint8Array payloads", () => {
      const data = new Uint8Array([1, 2, 3, 4]);
      const result = serializeSecretPayload(data);
      expect(result.encoding).toBe("base64");
      expect(result.value).toBe("AQIDBA==");
    });

    it("deserializes string payloads", () => {
      const serialized = { encoding: "utf8" as const, value: "test-value" };
      const result = deserializeSecretPayload(serialized);
      expect(result).toBe("test-value");
    });

    it("deserializes JSON payloads", () => {
      const payload = { key: "value", nested: { foo: "bar" } };
      const serialized = serializeSecretPayload(payload);
      const result = deserializeSecretPayload(serialized);
      expect(result).toEqual(payload);
    });

    it("deserializes base64 payloads", () => {
      const data = new Uint8Array([1, 2, 3, 4]);
      const serialized = serializeSecretPayload(data);
      const result = deserializeSecretPayload(serialized);
      expect(result).toBeInstanceOf(Buffer);
      expect((result as Buffer).toJSON().data).toEqual([1, 2, 3, 4]);
    });
  });

  describe("SecretError", () => {
    it("creates error with secretCode and message", () => {
      const error = new SecretError("SECRET_NOT_FOUND", "Secret not found");
      expect(error.secretCode).toBe("SECRET_NOT_FOUND");
      expect(error.message).toContain("Secret not found");
    });

    it("wraps cause error", () => {
      const cause = new Error("original error");
      const error = new SecretError("SECRET_NOT_FOUND", "Secret not found", cause);
      expect((error as any).cause).toBe(cause);
    });
  });
});
