/**
 * @module integrations/tests/unit/erpnext/ERPNextErrors
 * @summary Unit coverage for the ERPNext error hierarchy, Frappe message
 * extraction and HTTP/exception mapping.
 */
import { it } from "@decaf-ts/for-testing";
import { describe, expect } from "@jest/globals";
import {
  BadRequestError,
  ConflictError,
  NotFoundError,
  ValidationError,
} from "@decaf-ts/db-decorators";
import {
  ERPNextAuthenticationError,
  ERPNextConflictError,
  ERPNextConnectionError,
  ERPNextError,
  ERPNextNotFoundError,
  ERPNextPermissionError,
  ERPNextUnsupportedError,
  ERPNextValidationError,
  erpNextErrorMessage,
  parseERPNextError,
} from "../../../src/erpnext";

describe("ERPNextError hierarchy", () => {
  it("builds the base error with name and code", () => {
    const error = new ERPNextError("boom");
    expect(error).toBeInstanceOf(ERPNextError);
    expect(error.name).toBe(ERPNextError.name);
    expect((error as unknown as { code: number }).code).toBe(500);

    const custom = new ERPNextError(new Error("wrapped"), "Custom", 418);
    expect(custom.name).toBe("Custom");
    expect((custom as unknown as { code: number }).code).toBe(418);
  });

  it("maps every subclass to its decaf family", () => {
    expect(new ERPNextAuthenticationError("a")).toBeInstanceOf(
      ERPNextAuthenticationError
    );
    expect(new ERPNextPermissionError("a")).toBeInstanceOf(
      ERPNextPermissionError
    );
    expect(new ERPNextNotFoundError("a")).toBeInstanceOf(ERPNextNotFoundError);
    expect(new ERPNextConflictError("a")).toBeInstanceOf(ERPNextConflictError);
    expect(new ERPNextValidationError("a")).toBeInstanceOf(
      ERPNextValidationError
    );
    expect(new ERPNextConnectionError("a")).toBeInstanceOf(
      ERPNextConnectionError
    );
    expect(new ERPNextUnsupportedError("a")).toBeInstanceOf(
      ERPNextUnsupportedError
    );
  });
});

describe("erpNextErrorMessage", () => {
  it("returns undefined for nullish input", () => {
    expect(erpNextErrorMessage(undefined)).toBeUndefined();
    expect(erpNextErrorMessage(null)).toBeUndefined();
    expect(erpNextErrorMessage("")).toBe("");
  });

  it("parses plain and JSON-encoded strings", () => {
    expect(erpNextErrorMessage("plain failure")).toBe("plain failure");
    expect(
      erpNextErrorMessage(JSON.stringify({ message: "encoded failure" }))
    ).toBe("encoded failure");
  });

  it("walks arrays and nested objects", () => {
    expect(
      erpNextErrorMessage([{ message: "first" }, { message: "second" }])
    ).toBe("first");
    expect(erpNextErrorMessage([{}, { message: { error: "deep" } }])).toBe(
      "deep"
    );
  });

  it("extracts _server_messages and strips exception prefixes", () => {
    expect(
      erpNextErrorMessage({
        _server_messages: JSON.stringify([
          JSON.stringify({ message: "Customer Name is mandatory" }),
        ]),
      })
    ).toBe("Customer Name is mandatory");

    expect(
      erpNextErrorMessage({
        exception: "frappe.exceptions.ValidationError: bad payload",
      })
    ).toBe("bad payload");

    expect(erpNextErrorMessage({ error: "simple error" })).toBe("simple error");
    expect(erpNextErrorMessage({ exc_type: "ValidationError" })).toBe(
      "ValidationError"
    );
  });

  it("returns the raw value when _server_messages is not JSON", () => {
    expect(erpNextErrorMessage({ _server_messages: "not-json" })).toBe(
      "not-json"
    );
  });

  it("returns undefined when no known key holds a message", () => {
    expect(erpNextErrorMessage({ unrelated: true })).toBeUndefined();
  });
});

describe("parseERPNextError", () => {
  it("returns a decaf error unchanged", () => {
    const original = new ValidationError("already decaf");
    expect(parseERPNextError(500, original)).toBe(original);
  });

  it("refines the mapping from the Frappe exc_type", () => {
    expect(
      parseERPNextError(500, { exc_type: "PermissionError" })
    ).toBeInstanceOf(ERPNextPermissionError);
    expect(
      parseERPNextError(500, { exc_type: "AuthenticationError" })
    ).toBeInstanceOf(ERPNextAuthenticationError);
    expect(
      parseERPNextError(500, { exc_type: "DoesNotExistError" })
    ).toBeInstanceOf(ERPNextNotFoundError);
    expect(
      parseERPNextError(500, { exc_type: "MandatoryError" })
    ).toBeInstanceOf(ERPNextValidationError);
    expect(
      parseERPNextError(500, { exc_type: "DuplicateEntryError" })
    ).toBeInstanceOf(ERPNextConflictError);
  });

  it("maps bare HTTP statuses", () => {
    expect(parseERPNextError(403, {})).toBeInstanceOf(ERPNextPermissionError);
    expect(parseERPNextError(401, {})).toBeInstanceOf(
      ERPNextAuthenticationError
    );
    expect(parseERPNextError(404, {})).toBeInstanceOf(ERPNextNotFoundError);
    expect(parseERPNextError(417, {})).toBeInstanceOf(ERPNextValidationError);
    expect(parseERPNextError(422, {})).toBeInstanceOf(ERPNextValidationError);
    expect(parseERPNextError(409, {})).toBeInstanceOf(ERPNextConflictError);
    expect(parseERPNextError(400, {})).toBeInstanceOf(BadRequestError);
    expect(parseERPNextError(405, {})).toBeInstanceOf(ERPNextUnsupportedError);
    expect(parseERPNextError(408, {})).toBeInstanceOf(ERPNextConnectionError);
    expect(parseERPNextError(429, {})).toBeInstanceOf(ERPNextConnectionError);
    expect(parseERPNextError(502, {})).toBeInstanceOf(ERPNextConnectionError);
    expect(parseERPNextError(503, {})).toBeInstanceOf(ERPNextConnectionError);
    expect(parseERPNextError(504, {})).toBeInstanceOf(ERPNextConnectionError);
  });

  it("falls back to ERPNextError with or without a status", () => {
    const withStatus = parseERPNextError(500, {}) as unknown as {
      code: number;
    };
    expect(withStatus).toBeInstanceOf(ERPNextError);
    expect(withStatus.code).toBe(500);

    const withoutStatus = parseERPNextError(undefined, {}) as unknown as {
      code: number;
    };
    expect(withoutStatus).toBeInstanceOf(ERPNextError);
    expect(withoutStatus.code).toBe(500);
  });

  it("uses the generic HTTP message when the body has none", () => {
    const error = parseERPNextError(418, {}) as unknown as {
      message: string;
    };
    expect(error.message).toContain("HTTP 418");
    expect(new NotFoundError("x")).toBeInstanceOf(NotFoundError);
    expect(new ConflictError("x")).toBeInstanceOf(ConflictError);
  });
});
