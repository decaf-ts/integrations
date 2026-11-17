/**
 * @module integrations/tests/unit/erpnext/ERPNextPurchaseInvoiceModels
 * @summary Model decoration/metadata integrity for the ERPNext Purchase Invoice
 * doctype and its child item rows. No transport or credentials are involved.
 */
import { it } from "@decaf-ts/for-testing";
import { describe, expect } from "@jest/globals";
import { Model } from "@decaf-ts/decorator-validation";
import {
  ERPNextPurchaseInvoice,
  ERPNextPurchaseInvoiceItem,
} from "../../../src/erpnext";

function validItem(
  data: Partial<ERPNextPurchaseInvoiceItem> = {}
): ERPNextPurchaseInvoiceItem {
  return new ERPNextPurchaseInvoiceItem({
    item_name: "Widget",
    qty: 2,
    uom: "Nos",
    conversion_factor: 1,
    stock_qty: 2,
    rate: 10,
    amount: 20,
    base_rate: 10,
    base_amount: 20,
    ...data,
  });
}

function validInvoice(
  data: Partial<ERPNextPurchaseInvoice> = {}
): ERPNextPurchaseInvoice {
  return new ERPNextPurchaseInvoice({
    name: "PINV-1",
    supplier: "SUP-1",
    posting_date: new Date("2026-02-01T00:00:00.000Z"),
    items: [validItem()],
    ...data,
  });
}

function errorProperties(model: Model): string[] {
  return Object.keys(model.hasErrors() ?? {});
}

describe("ERPNextPurchaseInvoiceItem", () => {
  it("constructs from data and keeps its child attributes", () => {
    const item = validItem({ item_name: "Gadget", qty: 4 });
    expect(item).toBeInstanceOf(ERPNextPurchaseInvoiceItem);
    expect(item.item_name).toBe("Gadget");
    expect(item.qty).toBe(4);
    expect(item.hasErrors()).toBeFalsy();
  });

  it("requires the mandatory item attributes", () => {
    expect(new ERPNextPurchaseInvoiceItem({}).hasErrors()).toBeTruthy();
    expect(
      new ERPNextPurchaseInvoiceItem({
        item_name: "Widget",
        qty: 1,
        uom: "Nos",
        conversion_factor: 1,
        stock_qty: 1,
      } as never).hasErrors()
    ).toBeTruthy();
  });
});

describe("ERPNextPurchaseInvoice", () => {
  it("resolves the Purchase Invoice doctype and a primary key", () => {
    expect(Model.tableName(ERPNextPurchaseInvoice)).toBe("Purchase Invoice");
    expect(Model.pk(ERPNextPurchaseInvoice)).toBeTruthy();
  });

  it("accepts a fully decorated purchase invoice", () => {
    const invoice = validInvoice();
    expect(invoice.hasErrors()).toBeFalsy();
    expect(invoice.items[0]).toBeInstanceOf(ERPNextPurchaseInvoiceItem);
  });

  it("requires supplier, posting date and items", () => {
    expect(errorProperties(new ERPNextPurchaseInvoice({}))).toEqual(
      expect.arrayContaining(["supplier", "posting_date", "items"])
    );
    expect(
      errorProperties(validInvoice({ supplier: undefined } as never))
    ).toEqual(["supplier"]);
    expect(
      errorProperties(validInvoice({ posting_date: undefined } as never))
    ).toEqual(["posting_date"]);
    expect(errorProperties(validInvoice({ items: undefined } as never))).toEqual(
      ["items"]
    );
  });

  it("rejects a status outside the option set", () => {
    expect(errorProperties(validInvoice({ status: "Unknown" }))).toEqual([
      "status",
    ]);
  });
});
