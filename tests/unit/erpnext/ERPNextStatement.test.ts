/**
 * @module integrations/tests/unit/erpnext/ERPNextStatement
 * @summary Unit coverage for the ERPNext statement builder: predicate parsing,
 * Frappe filter translation, aggregation selectors and their validation.
 */
import { it } from "@decaf-ts/for-testing";
import { describe, expect } from "@jest/globals";
import { InternalError } from "@decaf-ts/db-decorators";
import {
  Condition,
  Operator,
  OrderDirection,
  QueryError,
} from "@decaf-ts/core";
import {
  ERPNextAdapter,
  ERPNextCustomer,
  ERPNextSalesInvoice,
  ERPNextStatement,
} from "../../../src/erpnext";
import type { ERPNextTransport } from "../../../src/erpnext";

const transport: ERPNextTransport = async () => ({
  status: 200,
  data: { data: [] },
});

const adapter = new ERPNextAdapter({
  baseUrl: "https://erp.example.com",
  apiKey: "k",
  apiSecret: "s",
  transport,
});

function statement() {
  return adapter.Statement<ERPNextSalesInvoice>() as ERPNextStatement<
    ERPNextSalesInvoice,
    unknown,
    never
  >;
}

function parseFilters(condition: unknown) {
  return (statement() as unknown as { parseFilters: (c: unknown) => unknown })
    .parseFilters(condition);
}

function parsePredicate(condition: unknown) {
  return (
    statement() as unknown as {
      parsePredicate: (c: unknown) => (model: unknown) => boolean;
    }
  ).parsePredicate(condition);
}

describe("ERPNextStatement.build", () => {
  it("assembles select/from/where/filters/order/limit/offset/groupBy", () => {
    const built = (
      statement()
        .from(ERPNextSalesInvoice)
        .select(["customer", "grand_total"])
        .where(
          Condition.attribute<ERPNextSalesInvoice>("status").eq("Draft")
        )
        .groupBy("customer")
        .orderBy(["posting_date", OrderDirection.DSC])
        .limit(5)
        .offset(2) as unknown as { build: () => Record<string, any> }
    ).build();

    expect(built.filters).toEqual([["status", "=", "Draft"]]);
    expect(built.orderBy).toEqual([
      { field: "posting_date", direction: "desc" },
    ]);
    expect(built.limit).toBe(5);
    expect(built.skip).toBe(2);
    expect(built.groupBy).toEqual(["customer"]);
    expect(
      built.where({ status: "Draft" })
    ).toBe(true);
    expect(
      built.where({ status: "Paid" })
    ).toBe(false);
  });

  it("records count, countDistinct, min, max, sum, avg and distinct selectors", () => {
    const count = (
      statement().from(ERPNextSalesInvoice).count() as unknown as {
        build: () => Record<string, any>;
      }
    ).build();
    expect(count.count).toBeNull();

    const countDistinct = (
      statement()
        .from(ERPNextSalesInvoice)
        .count("customer")
        .distinct() as unknown as { build: () => Record<string, any> }
    ).build();
    expect(countDistinct.countDistinct).toBe("customer");

    const aggregations = (
      statement()
        .from(ERPNextSalesInvoice)
        .min("grand_total") as unknown as { build: () => Record<string, any> }
    ).build();
    expect(aggregations.min).toBe("grand_total");

    const max = (
      statement()
        .from(ERPNextSalesInvoice)
        .max("grand_total") as unknown as { build: () => Record<string, any> }
    ).build();
    expect(max.max).toBe("grand_total");

    const sum = (
      statement()
        .from(ERPNextSalesInvoice)
        .sum("grand_total") as unknown as { build: () => Record<string, any> }
    ).build();
    expect(sum.sum).toBe("grand_total");

    const avg = (
      statement()
        .from(ERPNextSalesInvoice)
        .avg("posting_date") as unknown as { build: () => Record<string, any> }
    ).build();
    expect(avg.avg).toBe("posting_date");

    const distinct = (
      statement()
        .from(ERPNextSalesInvoice)
        .distinct("status") as unknown as { build: () => Record<string, any> }
    ).build();
    expect(distinct.distinct).toBe("status");
  });

  it("rejects aggregations on non numeric/date attributes", () => {
    expect(() =>
      (
        statement()
          .from(ERPNextSalesInvoice)
          .sum("customer") as unknown as { build: () => unknown }
      ).build()
    ).toThrow(QueryError);
    expect(() =>
      (
        statement()
          .from(ERPNextSalesInvoice)
          .min("customer") as unknown as { build: () => unknown }
      ).build()
    ).toThrow(QueryError);
    expect(() =>
      (
        statement()
          .from(ERPNextSalesInvoice)
          .max("customer") as unknown as { build: () => unknown }
      ).build()
    ).toThrow(QueryError);
    expect(() =>
      (
        statement()
          .from(ERPNextSalesInvoice)
          .avg("customer") as unknown as { build: () => unknown }
      ).build()
    ).toThrow(QueryError);
  });

  it("rejects an aggregation without a target model", () => {
    expect(() =>
      (
        statement().sum("grand_total") as unknown as { build: () => unknown }
      ).build()
    ).toThrow(InternalError);
  });

  it("rejects an aggregation on an unresolved attribute", () => {
    expect(() =>
      (
        statement()
          .from(ERPNextSalesInvoice)
          .sum("notARealAttribute") as unknown as { build: () => unknown }
      ).build()
    ).toThrow(QueryError);
  });
});

describe("ERPNextStatement.parseFilters", () => {
  it("combines AND groups into a flat filter list", () => {
    const condition = Condition.and(
      Condition.attribute<ERPNextSalesInvoice>("status").eq("Draft"),
      Condition.attribute<ERPNextSalesInvoice>("customer").eq("C1")
    );
    expect(parseFilters(condition)).toEqual([
      ["status", "=", "Draft"],
      ["customer", "=", "C1"],
    ]);
  });

  it("returns undefined for OR, NOT and REGEXP", () => {
    expect(
      parseFilters(
        Condition.or(
          Condition.attribute<ERPNextSalesInvoice>("status").eq("Draft"),
          Condition.attribute<ERPNextSalesInvoice>("status").eq("Paid")
        )
      )
    ).toBeUndefined();
    expect(
      parseFilters(
        Condition.attribute<ERPNextSalesInvoice>("status")
          .eq("Draft")
          .not(undefined)
      )
    ).toBeUndefined();
    expect(
      parseFilters(
        Condition.attribute<ERPNextSalesInvoice>("customer").regexp(".*")
      )
    ).toBeUndefined();
  });

  it("maps comparison operators onto Frappe operators", () => {
    expect(
      parseFilters(Condition.attribute<ERPNextSalesInvoice>("customer").dif("C1"))
    ).toEqual([["customer", "!=", "C1"]]);
    expect(
      parseFilters(Condition.attribute<ERPNextSalesInvoice>("grand_total").gt(10))
    ).toEqual([["grand_total", ">", 10]]);
    expect(
      parseFilters(Condition.attribute<ERPNextSalesInvoice>("grand_total").gte(10))
    ).toEqual([["grand_total", ">=", 10]]);
    expect(
      parseFilters(Condition.attribute<ERPNextSalesInvoice>("grand_total").lt(10))
    ).toEqual([["grand_total", "<", 10]]);
    expect(
      parseFilters(Condition.attribute<ERPNextSalesInvoice>("grand_total").lte(10))
    ).toEqual([["grand_total", "<=", 10]]);
    expect(
      parseFilters(
        Condition.attribute<ERPNextSalesInvoice>("customer").in(["C1", "C2"])
      )
    ).toEqual([["customer", "in", ["C1", "C2"]]]);
    expect(
      parseFilters(
        Condition.attribute<ERPNextSalesInvoice>("grand_total").between(1, 10)
      )
    ).toEqual([["grand_total", "between", [1, 10]]]);
    expect(
      parseFilters(
        Condition.attribute<ERPNextSalesInvoice>("customer").startsWith("C")
      )
    ).toEqual([["customer", "like", "C%"]]);
    expect(
      parseFilters(
        Condition.attribute<ERPNextSalesInvoice>("customer").endsWith("1")
      )
    ).toEqual([["customer", "like", "%1"]]);
    expect(
      parseFilters(
        Condition.attribute<ERPNextSalesInvoice>("customer").exists(true)
      )
    ).toEqual([["customer", "is", "set"]]);
    expect(
      parseFilters(
        Condition.attribute<ERPNextSalesInvoice>("customer").exists(false)
      )
    ).toEqual([["customer", "is", "not set"]]);
  });

  it("returns undefined for unrepresentable operator values", () => {
    expect(
      parseFilters(
        Condition.attribute<ERPNextSalesInvoice>("customer").in("C1" as never)
      )
    ).toBeUndefined();
    expect(
      parseFilters(
        Condition.attribute<ERPNextSalesInvoice>("customer").startsWith(
          1 as never
        )
      )
    ).toBeUndefined();
    expect(
      parseFilters(
        Condition.attribute<ERPNextSalesInvoice>("customer").endsWith(
          1 as never
        )
      )
    ).toBeUndefined();
    expect(parseFilters(Condition.attribute<ERPNextSalesInvoice>("customer"))).toBeUndefined();
  });
});

describe("ERPNextStatement.parsePredicate", () => {
  it("evaluates comparison operators", () => {
    const model = {
      customer: "ACME",
      grand_total: 50,
    };
    expect(
      parsePredicate(
        Condition.attribute<ERPNextSalesInvoice>("customer").eq("ACME")
      )(model)
    ).toBe(true);
    expect(
      parsePredicate(
        Condition.attribute<ERPNextSalesInvoice>("customer").dif("Other")
      )(model)
    ).toBe(true);
    expect(
      parsePredicate(
        Condition.attribute<ERPNextSalesInvoice>("grand_total").gt(10)
      )(model)
    ).toBe(true);
    expect(
      parsePredicate(
        Condition.attribute<ERPNextSalesInvoice>("grand_total").gte(50)
      )(model)
    ).toBe(true);
    expect(
      parsePredicate(
        Condition.attribute<ERPNextSalesInvoice>("grand_total").lt(100)
      )(model)
    ).toBe(true);
    expect(
      parsePredicate(
        Condition.attribute<ERPNextSalesInvoice>("grand_total").lte(50)
      )(model)
    ).toBe(true);
    expect(
      parsePredicate(
        Condition.attribute<ERPNextSalesInvoice>("grand_total").between(1, 100)
      )(model)
    ).toBe(true);
    expect(
      parsePredicate(
        Condition.attribute<ERPNextSalesInvoice>("customer").in(["ACME"])
      )(model)
    ).toBe(true);
    expect(
      parsePredicate(
        Condition.attribute<ERPNextSalesInvoice>("customer").startsWith("AC")
      )(model)
    ).toBe(true);
    expect(
      parsePredicate(
        Condition.attribute<ERPNextSalesInvoice>("customer").endsWith("ME")
      )(model)
    ).toBe(true);
    expect(
      parsePredicate(
        Condition.attribute<ERPNextSalesInvoice>("customer").regexp("A.*")
      )(model)
    ).toBe(true);
    expect(
      parsePredicate(
        Condition.attribute<ERPNextSalesInvoice>("customer").exists(true)
      )(model)
    ).toBe(true);
    expect(
      parsePredicate(
        Condition.attribute<ERPNextSalesInvoice>("customer").exists(false)
      )({})
    ).toBe(true);
  });

  it("evaluates AND/OR/NOT groups", () => {
    const model = { customer: "ACME", grand_total: 50 };
    const andCondition = Condition.and(
      Condition.attribute<ERPNextSalesInvoice>("customer").eq("ACME"),
      Condition.attribute<ERPNextSalesInvoice>("grand_total").gt(10)
    );
    expect(parsePredicate(andCondition)(model)).toBe(true);
    const orCondition = Condition.or(
      Condition.attribute<ERPNextSalesInvoice>("customer").eq("Other"),
      Condition.attribute<ERPNextSalesInvoice>("grand_total").gt(10)
    );
    expect(parsePredicate(orCondition)(model)).toBe(true);
    const notCondition = Condition.attribute<ERPNextSalesInvoice>(
      "customer"
    )
      .eq("Other")
      .not(undefined);
    expect(parsePredicate(notCondition)(model)).toBe(true);
  });

  it("rejects invalid operator operands", () => {
    expect(() =>
      parsePredicate(
        Condition.attribute<ERPNextSalesInvoice>("customer").in("ACME" as never)
      )({ customer: "ACME" })
    ).toThrow(QueryError);
    expect(() =>
      parsePredicate(
        Condition.attribute<ERPNextSalesInvoice>("customer").regexp("A")
      )({ customer: 42 })
    ).toThrow(QueryError);
    expect(() =>
      parsePredicate(
        Condition.attribute<ERPNextSalesInvoice>("customer").startsWith("A")
      )({ customer: 42 })
    ).toThrow(QueryError);
    expect(() =>
      parsePredicate(
        Condition.attribute<ERPNextSalesInvoice>("customer").endsWith("E")
      )({ customer: 42 })
    ).toThrow(QueryError);
  });

  it("rejects an unsupported operator", () => {
    const condition = Condition.attribute<ERPNextSalesInvoice>("customer") as any;
    expect(() => parsePredicate(condition)({ customer: "ACME" })).toThrow(
      InternalError
    );
  });

  it("uses the operator enum import", () => {
    expect(Operator.EQUAL).toBeDefined();
    expect(ERPNextCustomer).toBeDefined();
  });
});
