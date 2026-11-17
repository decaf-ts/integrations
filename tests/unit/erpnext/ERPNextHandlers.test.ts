/**
 * @module integrations/tests/unit/erpnext/ERPNextHandlers
 * @summary Unit coverage for the ERPNext createdBy/updatedBy handler.
 */
import { it } from "@decaf-ts/for-testing";
import { describe, expect } from "@jest/globals";
import { UnsupportedError } from "@decaf-ts/core";
import { createdByOnERPNextCreateUpdate } from "../../../src/erpnext";

function contextWith(uuid?: string) {
  return {
    get: (key: string) => (key === "UUID" ? uuid : undefined),
  };
}

describe("createdByOnERPNextCreateUpdate", () => {
  it("sets the attribute from the context UUID", async () => {
    const model: Record<string, unknown> = {};
    await createdByOnERPNextCreateUpdate.call(
      {} as never,
      contextWith("user-42") as never,
      {} as never,
      "createdBy" as never,
      model as never
    );
    expect(model.createdBy).toBe("user-42");
  });

  it("rejects an operation without a UUID", async () => {
    await expect(
      createdByOnERPNextCreateUpdate.call(
        {} as never,
        contextWith(undefined) as never,
        {} as never,
        "updatedBy" as never,
        {} as never
      )
    ).rejects.toBeInstanceOf(UnsupportedError);
  });
});
