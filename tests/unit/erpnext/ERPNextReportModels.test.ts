/**
 * @module integrations/tests/unit/erpnext/ERPNextReportModels
 * @summary Model decoration/metadata integrity for the ERPNext Report doctype:
 * table name, primary key, required fields and option constraints. No transport
 * or credentials are involved.
 */
import { it } from "@decaf-ts/for-testing";
import { describe, expect } from "@jest/globals";
import { Model } from "@decaf-ts/decorator-validation";
import { ERPNextReport } from "../../../src/erpnext";

function validReport(data: Partial<ERPNextReport> = {}): ERPNextReport {
  return new ERPNextReport({
    name: "RPT-1",
    report_name: "Sales Register",
    ref_doctype: "Sales Invoice",
    is_standard: "No",
    report_type: "Query Report",
    ...data,
  });
}

function errorProperties(model: Model): string[] {
  return Object.keys(model.hasErrors() ?? {});
}

describe("ERPNextReport", () => {
  it("resolves the Report doctype and a primary key", () => {
    expect(Model.tableName(ERPNextReport)).toBe("Report");
    expect(Model.pk(ERPNextReport)).toBeTruthy();
  });

  it("accepts a fully decorated report", () => {
    expect(validReport().hasErrors()).toBeFalsy();
  });

  it("requires report name, reference doctype, standard flag and report type", () => {
    expect(errorProperties(new ERPNextReport({}))).toEqual(
      expect.arrayContaining([
        "report_name",
        "ref_doctype",
        "is_standard",
        "report_type",
      ])
    );
    expect(
      errorProperties(validReport({ report_name: undefined } as never))
    ).toEqual(["report_name"]);
    expect(
      errorProperties(validReport({ ref_doctype: undefined } as never))
    ).toEqual(["ref_doctype"]);
    expect(
      errorProperties(validReport({ is_standard: undefined } as never))
    ).toEqual(["is_standard"]);
    expect(
      errorProperties(validReport({ report_type: undefined } as never))
    ).toEqual(["report_type"]);
  });

  it("rejects an is_standard value outside the option set", () => {
    expect(errorProperties(validReport({ is_standard: "Maybe" }))).toEqual([
      "is_standard",
    ]);
  });

  it("rejects a report type outside the option set", () => {
    expect(errorProperties(validReport({ report_type: "Ad Hoc" }))).toEqual([
      "report_type",
    ]);
  });
});
