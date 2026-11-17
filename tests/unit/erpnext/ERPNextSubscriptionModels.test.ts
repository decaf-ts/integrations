/**
 * @module integrations/tests/unit/erpnext/ERPNextSubscriptionModels
 * @summary Model decoration/metadata integrity for the ERPNext subscription
 * doctypes: table names, primary keys, required fields, option constraints and
 * child-model construction. No transport or credentials are involved.
 */
import { it } from "@decaf-ts/for-testing";
import { describe, expect } from "@jest/globals";
import { Model } from "@decaf-ts/decorator-validation";
import {
  ERPNextSubscription,
  ERPNextSubscriptionPlan,
  ERPNextSubscriptionPlanDetail,
} from "../../../src/erpnext";

function validPlanDetail(
  data: Partial<ERPNextSubscriptionPlanDetail> = {}
): ERPNextSubscriptionPlanDetail {
  return new ERPNextSubscriptionPlanDetail({ plan: "PLAN-1", qty: 1, ...data });
}

function validPlan(
  data: Partial<ERPNextSubscriptionPlan> = {}
): ERPNextSubscriptionPlan {
  return new ERPNextSubscriptionPlan({
    name: "PLAN-1",
    plan_name: "Starter",
    currency: "USD",
    item: "ITEM-1",
    price_determination: "Fixed Rate",
    billing_interval: "Month",
    billing_interval_count: 1,
    ...data,
  });
}

function validSubscription(
  data: Partial<ERPNextSubscription> = {}
): ERPNextSubscription {
  return new ERPNextSubscription({
    name: "SUB-1",
    party_type: "Customer",
    party: "ACME",
    generate_invoice_at: "End of the current subscription period",
    plans: [validPlanDetail()],
    ...data,
  });
}

function errorProperties(model: Model): string[] {
  return Object.keys(model.hasErrors() ?? {});
}

describe("ERPNextSubscriptionPlanDetail", () => {
  it("constructs from data and keeps its child attributes", () => {
    const detail = validPlanDetail({ plan: "PLAN-9", qty: 3 });
    expect(detail).toBeInstanceOf(ERPNextSubscriptionPlanDetail);
    expect(detail.plan).toBe("PLAN-9");
    expect(detail.qty).toBe(3);
    expect(detail.hasErrors()).toBeFalsy();
  });

  it("requires a plan and quantity", () => {
    expect(new ERPNextSubscriptionPlanDetail({}).hasErrors()).toBeTruthy();
    expect(
      new ERPNextSubscriptionPlanDetail({ plan: "PLAN-1" }).hasErrors()
    ).toBeTruthy();
  });
});

describe("ERPNextSubscriptionPlan", () => {
  it("resolves the Subscription Plan doctype and a primary key", () => {
    expect(Model.tableName(ERPNextSubscriptionPlan)).toBe("Subscription Plan");
    expect(Model.pk(ERPNextSubscriptionPlan)).toBeTruthy();
  });

  it("accepts a fully decorated plan", () => {
    expect(validPlan().hasErrors()).toBeFalsy();
  });

  it("requires the mandatory plan attributes", () => {
    expect(new ERPNextSubscriptionPlan({}).hasErrors()).toBeTruthy();
    const missingItem = validPlan({ item: undefined } as never);
    expect(missingItem.hasErrors()).toBeTruthy();
  });

  it("rejects a price determination outside the option set", () => {
    const invalid = validPlan({ price_determination: "Weekly" });
    expect(invalid.hasErrors()).toBeTruthy();
  });

  it("rejects a billing interval outside the option set", () => {
    const invalid = validPlan({ billing_interval: "Fortnight" });
    expect(invalid.hasErrors()).toBeTruthy();
  });
});

describe("ERPNextSubscription", () => {
  it("resolves the Subscription doctype and a primary key", () => {
    expect(Model.tableName(ERPNextSubscription)).toBe("Subscription");
    expect(Model.pk(ERPNextSubscription)).toBeTruthy();
  });

  it("accepts a fully decorated subscription with plan details", () => {
    const subscription = validSubscription();
    expect(subscription.hasErrors()).toBeFalsy();
    expect(subscription.plans[0]).toBeInstanceOf(
      ERPNextSubscriptionPlanDetail
    );
  });

  it("requires party type, party, invoice generation and plans", () => {
    expect(errorProperties(new ERPNextSubscription({}))).toEqual(
      expect.arrayContaining([
        "party_type",
        "party",
        "generate_invoice_at",
        "plans",
      ])
    );
    expect(
      errorProperties(validSubscription({ party_type: undefined } as never))
    ).toEqual(["party_type"]);
    expect(
      errorProperties(validSubscription({ party: undefined } as never))
    ).toEqual(["party"]);
    expect(
      errorProperties(
        validSubscription({ generate_invoice_at: undefined } as never)
      )
    ).toEqual(["generate_invoice_at"]);
    expect(
      errorProperties(validSubscription({ plans: undefined } as never))
    ).toEqual(["plans"]);
  });

  it("rejects a party type outside the option set", () => {
    expect(
      errorProperties(validSubscription({ party_type: "Employee" }))
    ).toEqual(["party_type"]);
  });

  it("rejects an invoice generation option outside the option set", () => {
    expect(
      errorProperties(validSubscription({ generate_invoice_at: "Whenever" }))
    ).toEqual(["generate_invoice_at"]);
  });
});
