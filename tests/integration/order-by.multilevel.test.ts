import { describe, it, expect, beforeAll, afterAll, jest } from "@jest/globals";
import { Condition, OrderDirection } from "@decaf-ts/core";
import { Model } from "@decaf-ts/decorator-validation";
import { RedisRepository } from "../../src/redis";
import {
  cleanupRedisTestResources,
  setupRedisAdapter,
  RedisTestResources,
} from "../helpers/redis";
import { ordered, RedisOrderedModel } from "./models";

Model.setBuilder(Model.fromModel);

jest.setTimeout(60000);

describe("Redis multi-level sorting", () => {
  let resources: RedisTestResources;
  let repo: RedisRepository<RedisOrderedModel>;

  beforeAll(async () => {
    resources = await setupRedisAdapter("order_by");
    repo = new RedisRepository(resources.adapter, RedisOrderedModel);
    await repo.createAll(ordered());
  });

  afterAll(async () => {
    await cleanupRedisTestResources(resources);
  });

  it("orders by group asc and rank asc using enum directions", async () => {
    const results = await repo
      .select()
      .where(Condition.attribute<RedisOrderedModel>("rank").gte(0))
      .orderBy("group", OrderDirection.ASC)
      .thenBy("rank", OrderDirection.ASC)
      .execute();

    expect(results.map((entry) => entry.group)).toEqual([
      "a",
      "a",
      "a",
      "b",
      "b",
    ]);

    const groupA = results
      .filter((entry) => entry.group === "a")
      .map((entry) => entry.rank);
    expect(groupA).toEqual([1, 2, 3]);

    const groupB = results
      .filter((entry) => entry.group === "b")
      .map((entry) => entry.rank);
    expect(groupB).toEqual([1, 2]);
  });

  it("supports string-based direction for chained sorts", async () => {
    const results = await repo
      .select()
      .where(Condition.attribute<RedisOrderedModel>("rank").gte(0))
      .orderBy("group", OrderDirection.DSC)
      .thenBy("rank", "desc")
      .execute();

    expect(results.map((entry) => entry.group)).toEqual([
      "b",
      "b",
      "a",
      "a",
      "a",
    ]);

    const groupB = results
      .filter((entry) => entry.group === "b")
      .map((entry) => entry.rank);
    expect(groupB).toEqual([2, 1]);
  });
});
