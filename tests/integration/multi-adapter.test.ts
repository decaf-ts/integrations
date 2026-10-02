import { describe, it, expect, beforeAll, afterAll, jest } from "@jest/globals";
import { Repository } from "@decaf-ts/core";
import { NotFoundError } from "@decaf-ts/db-decorators";
import { Model } from "@decaf-ts/decorator-validation";
import { RedisAdapter } from "../../src/redis";
import {
  cleanupRedisTestResources,
  setupRedisAdapter,
  RedisTestResources,
} from "../helpers/redis";
import { RedisCountryModel } from "./models";

Model.setBuilder(Model.fromModel);

jest.setTimeout(60000);

describe("multiple Redis adapters", () => {
  let first: RedisTestResources;
  let second: RedisTestResources;
  let repoA: Repository<RedisCountryModel, RedisAdapter>;
  let repoB: Repository<RedisCountryModel, RedisAdapter>;

  beforeAll(async () => {
    first = await setupRedisAdapter("multi-a", "redis-multi-a");
    second = await setupRedisAdapter("multi-b", "redis-multi-b");
    repoA = new Repository(first.adapter, RedisCountryModel, true);
    repoB = new Repository(second.adapter, RedisCountryModel, true);
  });

  afterAll(async () => {
    await cleanupRedisTestResources(first);
    await cleanupRedisTestResources(second);
  });

  it("binds each repository to its own adapter", () => {
    expect(repoA.adapter).toBe(first.adapter);
    expect(repoB.adapter).toBe(second.adapter);
    expect(repoA.adapter).not.toBe(repoB.adapter);
  });

  it("isolates data between adapters with different prefixes", async () => {
    await repoA.create(
      new RedisCountryModel({
        id: 1,
        name: "only-in-a",
        countryCode: "pt",
        locale: "pt_PT",
      })
    );

    const inA = await repoA.read(1);
    expect(inA.name).toBe("only-in-a");

    await expect(repoB.read(1)).rejects.toThrow(NotFoundError);
  });

  it("keeps both adapters usable after writes", async () => {
    await repoB.create(
      new RedisCountryModel({
        id: 2,
        name: "only-in-b",
        countryCode: "es",
        locale: "es_ES",
      })
    );

    expect((await repoA.read(1)).name).toBe("only-in-a");
    expect((await repoB.read(2)).name).toBe("only-in-b");
    await expect(repoA.read(2)).rejects.toThrow(NotFoundError);
  });
});
