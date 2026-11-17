/**
 * @module integrations/tests/unit/erpnext/ERPNextAccountingModels
 * @summary Model decoration/metadata integrity for the ERPNext accounting
 * doctypes: table names, primary keys, required fields, option constraints and
 * child-model construction, plus the non-persisted chart-of-accounts view model.
 * No transport or credentials are involved.
 */
import { it } from "@decaf-ts/for-testing";
import { describe, expect } from "@jest/globals";
import { Model } from "@decaf-ts/decorator-validation";
import {
  ERPNextAccount,
  ERPNextChartOfAccountsNode,
  ERPNextFiscalYear,
  ERPNextFiscalYearCompany,
  ERPNextGLEntry,
  ERPNextJournalEntry,
  ERPNextJournalEntryAccount,
} from "../../../src/erpnext";

function validJournalAccount(
  data: Partial<ERPNextJournalEntryAccount> = {}
): ERPNextJournalEntryAccount {
  return new ERPNextJournalEntryAccount({ account: "Cash", ...data });
}

function validJournalEntry(
  data: Partial<ERPNextJournalEntry> = {}
): ERPNextJournalEntry {
  return new ERPNextJournalEntry({
    name: "JE-1",
    voucher_type: "Journal Entry",
    company: "ACME",
    posting_date: new Date("2026-03-01T00:00:00.000Z"),
    accounts: [validJournalAccount()],
    ...data,
  });
}

function validAccount(data: Partial<ERPNextAccount> = {}): ERPNextAccount {
  return new ERPNextAccount({
    name: "ACC-1",
    account_name: "Cash",
    company: "ACME",
    parent_account: "Current Assets",
    ...data,
  });
}

function validFiscalYear(
  data: Partial<ERPNextFiscalYear> = {}
): ERPNextFiscalYear {
  return new ERPNextFiscalYear({
    name: "FY-2026",
    year: "2026",
    year_start_date: new Date("2026-01-01T00:00:00.000Z"),
    year_end_date: new Date("2026-12-31T00:00:00.000Z"),
    ...data,
  });
}

function errorProperties(model: Model): string[] {
  return Object.keys(model.hasErrors() ?? {});
}

describe("ERPNextJournalEntryAccount", () => {
  it("constructs from data and requires the account", () => {
    const row = validJournalAccount({ debit: 25 });
    expect(row).toBeInstanceOf(ERPNextJournalEntryAccount);
    expect(row.account).toBe("Cash");
    expect(row.debit).toBe(25);
    expect(row.hasErrors()).toBeFalsy();
    expect(new ERPNextJournalEntryAccount({}).hasErrors()).toBeTruthy();
  });
});

describe("ERPNextJournalEntry", () => {
  it("resolves the Journal Entry doctype and a primary key", () => {
    expect(Model.tableName(ERPNextJournalEntry)).toBe("Journal Entry");
    expect(Model.pk(ERPNextJournalEntry)).toBeTruthy();
  });

  it("accepts a fully decorated journal entry", () => {
    const entry = validJournalEntry();
    expect(entry.hasErrors()).toBeFalsy();
    expect(entry.accounts[0]).toBeInstanceOf(ERPNextJournalEntryAccount);
  });

  it("requires voucher type, company, posting date and accounts", () => {
    expect(errorProperties(new ERPNextJournalEntry({}))).toEqual(
      expect.arrayContaining([
        "voucher_type",
        "company",
        "posting_date",
        "accounts",
      ])
    );
    expect(
      errorProperties(validJournalEntry({ voucher_type: undefined } as never))
    ).toEqual(["voucher_type"]);
    expect(
      errorProperties(validJournalEntry({ company: undefined } as never))
    ).toEqual(["company"]);
    expect(
      errorProperties(validJournalEntry({ posting_date: undefined } as never))
    ).toEqual(["posting_date"]);
    expect(
      errorProperties(validJournalEntry({ accounts: undefined } as never))
    ).toEqual(["accounts"]);
  });

  it("rejects a voucher type outside the option set", () => {
    expect(
      errorProperties(validJournalEntry({ voucher_type: "Random Entry" }))
    ).toEqual(["voucher_type"]);
  });
});

describe("ERPNextAccount", () => {
  it("resolves the Account doctype and a primary key", () => {
    expect(Model.tableName(ERPNextAccount)).toBe("Account");
    expect(Model.pk(ERPNextAccount)).toBeTruthy();
  });

  it("accepts a fully decorated account", () => {
    expect(validAccount().hasErrors()).toBeFalsy();
  });

  it("requires account name, company and parent account", () => {
    expect(new ERPNextAccount({}).hasErrors()).toBeTruthy();
    expect(
      validAccount({ parent_account: undefined } as never).hasErrors()
    ).toBeTruthy();
  });

  it("rejects a root type outside the option set", () => {
    expect(validAccount({ root_type: "Revenue" }).hasErrors()).toBeTruthy();
  });
});

describe("ERPNextFiscalYearCompany", () => {
  it("constructs from data and requires the company", () => {
    const row = new ERPNextFiscalYearCompany({ company: "ACME" });
    expect(row).toBeInstanceOf(ERPNextFiscalYearCompany);
    expect(row.company).toBe("ACME");
    expect(row.hasErrors()).toBeFalsy();
    expect(new ERPNextFiscalYearCompany({}).hasErrors()).toBeTruthy();
  });
});

describe("ERPNextFiscalYear", () => {
  it("resolves the Fiscal Year doctype and a primary key", () => {
    expect(Model.tableName(ERPNextFiscalYear)).toBe("Fiscal Year");
    expect(Model.pk(ERPNextFiscalYear)).toBeTruthy();
  });

  it("accepts a fully decorated fiscal year", () => {
    expect(validFiscalYear().hasErrors()).toBeFalsy();
  });

  it("requires year and both boundary dates", () => {
    expect(errorProperties(new ERPNextFiscalYear({}))).toEqual(
      expect.arrayContaining(["year", "year_start_date", "year_end_date"])
    );
    expect(
      errorProperties(validFiscalYear({ year: undefined } as never))
    ).toEqual(["year"]);
    expect(
      errorProperties(validFiscalYear({ year_start_date: undefined } as never))
    ).toEqual(["year_start_date"]);
    expect(
      errorProperties(validFiscalYear({ year_end_date: undefined } as never))
    ).toEqual(["year_end_date"]);
  });
});

describe("ERPNextGLEntry", () => {
  it("resolves the GL Entry doctype and a primary key", () => {
    expect(Model.tableName(ERPNextGLEntry)).toBe("GL Entry");
    expect(Model.pk(ERPNextGLEntry)).toBeTruthy();
  });

  it("accepts a read-only ledger row without additional required fields", () => {
    const entry = new ERPNextGLEntry({
      name: "GL-1",
      posting_date: new Date("2026-03-01T00:00:00.000Z"),
      account: "Cash",
      debit: 10,
    });
    expect(entry).toBeInstanceOf(ERPNextGLEntry);
    expect(entry.hasErrors()).toBeFalsy();
  });
});

describe("ERPNextChartOfAccountsNode", () => {
  it("is a constructible view model with nested children", () => {
    const node = new ERPNextChartOfAccountsNode({
      account: "ACC-1",
      account_name: "Cash",
      parent_account: "Current Assets",
      children: [
        new ERPNextChartOfAccountsNode({
          account: "ACC-2",
          account_name: "Petty Cash",
        }),
      ],
    });
    expect(node).toBeInstanceOf(ERPNextChartOfAccountsNode);
    expect(node.children).toHaveLength(1);
    expect(node.children?.[0].account_name).toBe("Petty Cash");
    expect(node.hasErrors()).toBeFalsy();
  });
});
