import { describe, it, expect, beforeAll, afterAll, jest } from "@jest/globals";
import { OrderDirection, Paginator, Repository } from "@decaf-ts/core";
import { Model } from "@decaf-ts/decorator-validation";
import { RedisAdapter } from "../../src/redis";
import {
  cleanupRedisTestResources,
  setupRedisAdapter,
  RedisTestResources,
} from "../helpers/redis";
import { countries, RedisCountryModel } from "./models";

Model.setBuilder(Model.fromModel);

jest.setTimeout(60000);

describe("Redis pagination", () => {
  let resources: RedisTestResources;
  let repo: Repository<RedisCountryModel, RedisAdapter>;

  const size = 25;

  beforeAll(async () => {
    resources = await setupRedisAdapter("pagination");
    repo = new Repository(resources.adapter, RedisCountryModel);
    const created = await repo.createAll(countries(10));
    expect(created).toHaveLength(10);
  });

  afterAll(async () => {
    await cleanupRedisTestResources(resources);
  });

  it("sorts records by an indexed property", async () => {
    const sorted = await repo
      .select()
      .orderBy(["id", OrderDirection.ASC])
      .execute();
    expect(sorted).toHaveLength(10);
    expect(sorted.map((c) => c.id)).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10,
    ]);
  });

  it("paginates through the result set", async () => {
    const paginator: Paginator<RedisCountryModel> = await repo
      .select()
      .orderBy(["id", OrderDirection.DSC])
      .paginate(size);

    expect(paginator).toBeDefined();
    expect(paginator.size).toEqual(size);
    expect(paginator.current).toBeUndefined();

    const page1 = await paginator.page();
    expect(page1.map((c) => c.id)).toEqual([
      10, 9, 8, 7, 6, 5, 4, 3, 2, 1,
    ]);
    expect(paginator.current).toEqual(1);
  });

  it("advances page by page with next()", async () => {
    const paginator: Paginator<RedisCountryModel> = await repo
      .select()
      .orderBy(["id", OrderDirection.ASC])
      .paginate(3);

    const first = await paginator.page();
    expect(first.map((c) => c.id)).toEqual([1, 2, 3]);

    const second = await paginator.next();
    expect(second.map((c) => c.id)).toEqual([4, 5, 6]);

    const third = await paginator.next();
    expect(third.map((c) => c.id)).toEqual([7, 8, 9]);

    const fourth = await paginator.next();
    expect(fourth.map((c) => c.id)).toEqual([10]);
  });
});
