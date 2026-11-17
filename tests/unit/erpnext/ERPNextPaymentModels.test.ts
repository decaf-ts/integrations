/**
 * @module integrations/tests/unit/erpnext/ERPNextPaymentModels
 * @summary Model decoration/metadata integrity for the ERPNext payment doctypes:
 * table names, primary keys, required fields, option constraints and child-model
 * construction. No transport or credentials are involved.
 */
import { it } from "@decaf-ts/for-testing";
import { describe, expect } from "@jest/globals";
import { Model } from "@decaf-ts/decorator-validation";
import {
  ERPNextPaymentEntry,
  ERPNextPaymentEntryDeduction,
  ERPNextPaymentEntryReference,
  ERPNextPaymentGateway,
  ERPNextPaymentGatewayAccount,
  ERPNextPaymentRequest,
} from "../../../src/erpnext";

function validPaymentEntry(
  data: Partial<ERPNextPaymentEntry> = {}
): ERPNextPaymentEntry {
  return new ERPNextPaymentEntry({
    name: "PE-1",
    payment_type: "Receive",
    posting_date: new Date("2026-01-05T00:00:00.000Z"),
    company: "ACME",
    paid_from: "Debtors",
    paid_from_account_currency: "USD",
    paid_to: "Cash",
    paid_to_account_currency: "USD",
    paid_amount: 100,
    source_exchange_rate: 1,
    base_paid_amount: 100,
    received_amount: 100,
    target_exchange_rate: 1,
    base_received_amount: 100,
    ...data,
  });
}

function validPaymentRequest(
  data: Partial<ERPNextPaymentRequest> = {}
): ERPNextPaymentRequest {
  return new ERPNextPaymentRequest({
    name: "PREQ-1",
    payment_request_type: "Inward",
    grand_total: 100,
    ...data,
  });
}

function errorProperties(model: Model): string[] {
  return Object.keys(model.hasErrors() ?? {});
}

describe("ERPNextPaymentEntry child models", () => {
  it("constructs a payment entry reference and requires its doctype", () => {
    const reference = new ERPNextPaymentEntryReference({
      reference_doctype: "Sales Invoice",
      reference_name: "SINV-1",
      allocated_amount: 50,
    });
    expect(reference).toBeInstanceOf(ERPNextPaymentEntryReference);
    expect(reference.reference_doctype).toBe("Sales Invoice");
    expect(reference.hasErrors()).toBeFalsy();
    expect(
      new ERPNextPaymentEntryReference({}).hasErrors()
    ).toBeTruthy();
  });

  it("constructs a payment entry deduction and requires its accounting fields", () => {
    const deduction = new ERPNextPaymentEntryDeduction({
      account: "Bank Charges",
      cost_center: "Main",
      amount: 5,
    });
    expect(deduction).toBeInstanceOf(ERPNextPaymentEntryDeduction);
    expect(deduction.amount).toBe(5);
    expect(deduction.hasErrors()).toBeFalsy();
    expect(new ERPNextPaymentEntryDeduction({}).hasErrors()).toBeTruthy();
  });
});

describe("ERPNextPaymentEntry", () => {
  it("resolves the Payment Entry doctype and a primary key", () => {
    expect(Model.tableName(ERPNextPaymentEntry)).toBe("Payment Entry");
    expect(Model.pk(ERPNextPaymentEntry)).toBeTruthy();
  });

  it("accepts a fully decorated payment entry", () => {
    expect(validPaymentEntry().hasErrors()).toBeFalsy();
  });

  it("requires the accounting and amount attributes", () => {
    expect(errorProperties(new ERPNextPaymentEntry({}))).toEqual(
      expect.arrayContaining([
        "payment_type",
        "posting_date",
        "company",
        "paid_from",
        "paid_from_account_currency",
        "paid_to",
        "paid_to_account_currency",
        "paid_amount",
        "source_exchange_rate",
        "base_paid_amount",
        "received_amount",
        "target_exchange_rate",
        "base_received_amount",
      ])
    );
    expect(
      errorProperties(
        validPaymentEntry({ received_amount: undefined } as never)
      )
    ).toEqual(["received_amount"]);
    expect(
      errorProperties(
        validPaymentEntry({ source_exchange_rate: undefined } as never)
      )
    ).toEqual(["source_exchange_rate"]);
  });

  it("rejects a payment type outside the option set", () => {
    expect(
      errorProperties(validPaymentEntry({ payment_type: "Transfer" }))
    ).toEqual(["payment_type"]);
  });

  it("validates nested references", () => {
    const entry = validPaymentEntry({
      references: [
        new ERPNextPaymentEntryReference({ reference_doctype: "Sales Invoice" }),
      ],
    });
    expect(entry.hasErrors()).toBeFalsy();
  });
});

describe("ERPNextPaymentRequest", () => {
  it("resolves the Payment Request doctype and a primary key", () => {
    expect(Model.tableName(ERPNextPaymentRequest)).toBe("Payment Request");
    expect(Model.pk(ERPNextPaymentRequest)).toBeTruthy();
  });

  it("accepts a fully decorated payment request", () => {
    expect(validPaymentRequest().hasErrors()).toBeFalsy();
  });

  it("requires a request type and a grand total", () => {
    expect(errorProperties(new ERPNextPaymentRequest({}))).toEqual(
      expect.arrayContaining(["payment_request_type", "grand_total"])
    );
    expect(
      errorProperties(
        validPaymentRequest({ payment_request_type: undefined } as never)
      )
    ).toEqual(["payment_request_type"]);
    expect(
      errorProperties(validPaymentRequest({ grand_total: undefined } as never))
    ).toEqual(["grand_total"]);
  });

  it("rejects a request type outside the option set", () => {
    expect(
      errorProperties(
        validPaymentRequest({ payment_request_type: "Sideways" })
      )
    ).toEqual(["payment_request_type"]);
  });
});

describe("ERPNextPaymentGateway", () => {
  it("resolves the Payment Gateway doctype and a primary key", () => {
    expect(Model.tableName(ERPNextPaymentGateway)).toBe("Payment Gateway");
    expect(Model.pk(ERPNextPaymentGateway)).toBeTruthy();
  });

  it("requires the gateway identifier", () => {
    const gateway = new ERPNextPaymentGateway({
      name: "Stripe",
      gateway: "Stripe",
    });
    expect(gateway.hasErrors()).toBeFalsy();
    expect(new ERPNextPaymentGateway({}).hasErrors()).toBeTruthy();
  });
});

describe("ERPNextPaymentGatewayAccount", () => {
  it("resolves the Payment Gateway Account doctype and a primary key", () => {
    expect(Model.tableName(ERPNextPaymentGatewayAccount)).toBe(
      "Payment Gateway Account"
    );
    expect(Model.pk(ERPNextPaymentGatewayAccount)).toBeTruthy();
  });

  it("requires gateway, company and payment account", () => {
    const account = new ERPNextPaymentGatewayAccount({
      name: "Stripe - ACME",
      payment_gateway: "Stripe",
      company: "ACME",
      payment_account: "Stripe Clearing",
    });
    expect(account.hasErrors()).toBeFalsy();
    expect(new ERPNextPaymentGatewayAccount({}).hasErrors()).toBeTruthy();
  });
});
