/**
 * @module integrations/tests/unit/erpnext/ERPNextPromotionModels
 * @summary Model decoration/metadata integrity for the ERPNext promotion
 * doctypes: table names, primary keys, required fields, option constraints and
 * child-model construction. No transport or credentials are involved.
 */
import { it } from "@decaf-ts/for-testing";
import { describe, expect } from "@jest/globals";
import { Model } from "@decaf-ts/decorator-validation";
import {
  ERPNextCouponCode,
  ERPNextPricingRule,
  ERPNextPricingRuleBrand,
  ERPNextPricingRuleItemCode,
  ERPNextPricingRuleItemGroup,
  ERPNextPromotionalScheme,
  ERPNextPromotionalSchemePriceDiscount,
  ERPNextPromotionalSchemeProductDiscount,
} from "../../../src/erpnext";

function validScheme(
  data: Partial<ERPNextPromotionalScheme> = {}
): ERPNextPromotionalScheme {
  return new ERPNextPromotionalScheme({
    name: "SCHEME-1",
    apply_on: "Item Code",
    company: "ACME",
    ...data,
  });
}

function validPricingRule(
  data: Partial<ERPNextPricingRule> = {}
): ERPNextPricingRule {
  return new ERPNextPricingRule({
    name: "PR-1",
    title: "Ten percent off",
    apply_on: "Item Code",
    price_or_product_discount: "Price",
    currency: "USD",
    ...data,
  });
}

function validCoupon(
  data: Partial<ERPNextCouponCode> = {}
): ERPNextCouponCode {
  return new ERPNextCouponCode({
    name: "COUPON-1",
    coupon_name: "Spring sale",
    coupon_type: "Promotional",
    pricing_rule: "PR-1",
    ...data,
  });
}

function errorProperties(model: Model): string[] {
  return Object.keys(model.hasErrors() ?? {});
}

describe("ERPNextPromotionalScheme child models", () => {
  it("constructs price discount slabs and requires a rule description", () => {
    const slab = new ERPNextPromotionalSchemePriceDiscount({
      rule_description: "10% above 5 units",
      discount_percentage: 10,
    });
    expect(slab).toBeInstanceOf(ERPNextPromotionalSchemePriceDiscount);
    expect(slab.discount_percentage).toBe(10);
    expect(slab.hasErrors()).toBeFalsy();
    expect(
      new ERPNextPromotionalSchemePriceDiscount({}).hasErrors()
    ).toBeTruthy();
  });

  it("rejects a price discount percentage above 100", () => {
    const slab = new ERPNextPromotionalSchemePriceDiscount({
      rule_description: "too much",
      discount_percentage: 150,
    });
    expect(slab.hasErrors()).toBeTruthy();
  });

  it("constructs product discount slabs and requires a rule description", () => {
    const slab = new ERPNextPromotionalSchemeProductDiscount({
      rule_description: "Free item above 2 units",
      free_item: "ITEM-1",
      free_qty: 1,
    });
    expect(slab).toBeInstanceOf(ERPNextPromotionalSchemeProductDiscount);
    expect(slab.free_item).toBe("ITEM-1");
    expect(slab.hasErrors()).toBeFalsy();
    expect(
      new ERPNextPromotionalSchemeProductDiscount({}).hasErrors()
    ).toBeTruthy();
  });

  it("constructs the pricing-rule item code, item group and brand rows", () => {
    const itemCode = new ERPNextPricingRuleItemCode({
      item_code: "ITEM-1",
      uom: "Nos",
    });
    const itemGroup = new ERPNextPricingRuleItemGroup({
      item_group: "Products",
      uom: "Nos",
    });
    const brand = new ERPNextPricingRuleBrand({ brand: "ACME", uom: "Nos" });

    expect(itemCode).toBeInstanceOf(ERPNextPricingRuleItemCode);
    expect(itemGroup).toBeInstanceOf(ERPNextPricingRuleItemGroup);
    expect(brand).toBeInstanceOf(ERPNextPricingRuleBrand);
    expect(itemCode.item_code).toBe("ITEM-1");
    expect(itemGroup.item_group).toBe("Products");
    expect(brand.brand).toBe("ACME");
    expect(itemCode.hasErrors()).toBeFalsy();
    expect(itemGroup.hasErrors()).toBeFalsy();
    expect(brand.hasErrors()).toBeFalsy();
  });
});

describe("ERPNextPromotionalScheme", () => {
  it("resolves the Promotional Scheme doctype and a primary key", () => {
    expect(Model.tableName(ERPNextPromotionalScheme)).toBe(
      "Promotional Scheme"
    );
    expect(Model.pk(ERPNextPromotionalScheme)).toBeTruthy();
  });

  it("accepts a fully decorated scheme", () => {
    expect(validScheme().hasErrors()).toBeFalsy();
  });

  it("requires apply_on and company", () => {
    expect(errorProperties(new ERPNextPromotionalScheme({}))).toEqual(
      expect.arrayContaining(["apply_on", "company"])
    );
    expect(
      errorProperties(validScheme({ apply_on: undefined } as never))
    ).toEqual(["apply_on"]);
    expect(errorProperties(validScheme({ company: undefined } as never))).toEqual(
      ["company"]
    );
  });

  it("rejects an apply_on value outside the option set", () => {
    expect(errorProperties(validScheme({ apply_on: "Supplier" }))).toEqual([
      "apply_on",
    ]);
  });
});

describe("ERPNextPricingRule", () => {
  it("resolves the Pricing Rule doctype and a primary key", () => {
    expect(Model.tableName(ERPNextPricingRule)).toBe("Pricing Rule");
    expect(Model.pk(ERPNextPricingRule)).toBeTruthy();
  });

  it("accepts a fully decorated pricing rule", () => {
    expect(validPricingRule().hasErrors()).toBeFalsy();
  });

  it("requires title, apply_on, discount mode and currency", () => {
    expect(errorProperties(new ERPNextPricingRule({}))).toEqual(
      expect.arrayContaining([
        "title",
        "apply_on",
        "price_or_product_discount",
        "currency",
      ])
    );
    expect(
      errorProperties(validPricingRule({ title: undefined } as never))
    ).toEqual(["title"]);
    expect(
      errorProperties(validPricingRule({ apply_on: undefined } as never))
    ).toEqual(["apply_on"]);
    expect(
      errorProperties(
        validPricingRule({ price_or_product_discount: undefined } as never)
      )
    ).toEqual(["price_or_product_discount"]);
    expect(
      errorProperties(validPricingRule({ currency: undefined } as never))
    ).toEqual(["currency"]);
  });

  it("rejects a price/product discount value outside the option set", () => {
    expect(
      errorProperties(validPricingRule({ price_or_product_discount: "Both" }))
    ).toEqual(["price_or_product_discount"]);
  });
});

describe("ERPNextCouponCode", () => {
  it("resolves the Coupon Code doctype and a primary key", () => {
    expect(Model.tableName(ERPNextCouponCode)).toBe("Coupon Code");
    expect(Model.pk(ERPNextCouponCode)).toBeTruthy();
  });

  it("accepts a fully decorated coupon", () => {
    expect(validCoupon().hasErrors()).toBeFalsy();
  });

  it("requires coupon name, type and pricing rule", () => {
    expect(new ERPNextCouponCode({}).hasErrors()).toBeTruthy();
    expect(
      validCoupon({ pricing_rule: undefined } as never).hasErrors()
    ).toBeTruthy();
  });

  it("rejects a coupon type outside the option set", () => {
    expect(validCoupon({ coupon_type: "Discount" }).hasErrors()).toBeTruthy();
  });
});
