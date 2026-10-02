import { describe, it, expect, beforeAll, afterAll, jest } from "@jest/globals";
import { Condition, OrderDirection, Repository } from "@decaf-ts/core";
import { Model } from "@decaf-ts/decorator-validation";
import { deserialize, RedisAdapter, serialize } from "../../src/redis";
import {
  cleanupRedisTestResources,
  setupRedisAdapter,
  RedisTestResources,
} from "../helpers/redis";
import { RedisTemporalModel } from "./models";

Model.setBuilder(Model.fromModel);

jest.setTimeout(60000);

describe("Redis Date/bigint round-trip", () => {
  let resources: RedisTestResources;
  let repo: Repository<RedisTemporalModel, RedisAdapter>;

  const records = [
    new RedisTemporalModel({
      id: 1,
      name: "epoch",
      when: new Date("2020-01-01T00:00:00.000Z"),
      big: 1n,
    }),
    new RedisTemporalModel({
      id: 2,
      name: "recent",
      when: new Date("2024-05-06T07:08:09.123Z"),
      big: 9007199254740993n,
    }),
    new RedisTemporalModel({
      id: 3,
      name: "future",
      when: new Date("2030-12-31T23:59:59.000Z"),
      big: 12345678901234567890n,
    }),
  ];

  beforeAll(async () => {
    resources = await setupRedisAdapter("date-bigint");
    repo = new Repository(resources.adapter, RedisTemporalModel);
    await repo.createAll(records);
  });

  afterAll(async () => {
    await cleanupRedisTestResources(resources);
  });

  it("serializes and deserializes bigint without loss", () => {
    const payload = { when: records[1].when, big: records[1].big };
    const restored: any = deserialize(serialize(payload));
    expect(restored.big).toBe(9007199254740993n);
  });

  it("round-trips Date through create/read", async () => {
    const read = await repo.read(2);
    expect(read.when).toBeInstanceOf(Date);
    expect(read.when.toISOString()).toBe("2024-05-06T07:08:09.123Z");
    expect(read.big).toBe(9007199254740993n);
  });

  it("round-trips bigint through bulk read", async () => {
    const read = await repo.readAll([1, 2, 3]);
    expect(read.map((r) => r.big)).toEqual(records.map((r) => r.big));
  });

  it("queries date ranges", async () => {
    const recent = await repo
      .select()
      .where(
        Condition.attribute<RedisTemporalModel>("when").gte(
          new Date("2024-01-01T00:00:00.000Z")
        )
      )
      .orderBy(["when", OrderDirection.ASC])
      .execute();
    expect(recent.map((r) => r.name)).toEqual(["recent", "future"]);
  });

  it("queries bigint values", async () => {
    const large = await repo
      .select()
      .where(
        Condition.attribute<RedisTemporalModel>("big").gt(10000000000000000000n)
      )
      .execute();
    expect(large.map((r) => r.name)).toEqual(["future"]);
  });
});
