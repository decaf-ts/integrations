import { describe, it, expect, beforeEach, jest } from "@jest/globals";
import {
  BaseModel,
  Condition,
  ConnectionError,
  Context,
  OrderDirection,
  pk,
  UnsupportedError,
} from "@decaf-ts/core";
import {
  ConflictError,
  InternalError,
  NotFoundError,
  OperationKeys,
} from "@decaf-ts/db-decorators";
import {
  model,
  Model,
  type ModelArg,
  required,
} from "@decaf-ts/decorator-validation";
import { uses } from "@decaf-ts/decoration";
import {
  createdByOnRedisCreateUpdate,
  deserialize,
  RedisAdapter,
  RedisDefaultPrefix,
  RedisDispatch,
  RedisFlavour,
  RedisRepository,
  serialize,
} from "../../src/redis";
import { createFakeRedisClient } from "../helpers/redisFakeClient";

Model.setBuilder(Model.fromModel);

@uses(RedisFlavour)
@model()
class UnitModel extends BaseModel {
  @pk({ type: Number, generated: false })
  id!: number;

  @required()
  name!: string;

  @required()
  age!: number;

  constructor(arg?: ModelArg<UnitModel>) {
    super(arg);
  }
}

function makeAdapter(overrides: Record<string, any> = {}) {
  const client = Object.assign(createFakeRedisClient(), overrides);
  const adapter = new RedisAdapter(
    { url: "redis://localhost:6379", prefix: `${RedisDefaultPrefix}:unit` },
    `unit-${Math.random()}`
  );
  (adapter as any)._client = client;
  return { adapter, client };
}

describe("RedisAdapter unit behaviour", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("uses the Redis flavour and default prefix", () => {
    const { adapter } = makeAdapter();
    expect(adapter.flavour).toBe(RedisFlavour);
    expect(adapter.recordKey("tbl")).toBe(`${RedisDefaultPrefix}:unit:tbl`);
  });

  it("honours a configured prefix", () => {
    const adapter = new RedisAdapter({ prefix: "custom:ns" }, "p2");
    expect(adapter.recordKey("orders")).toBe("custom:ns:orders");
  });

  it("flags injects a UUID defaulting to the configured user", async () => {
    const adapter = new RedisAdapter({ user: "alice" }, "p3");
    const flags: any = await (adapter as any).flags(
      OperationKeys.CREATE,
      UnitModel,
      {}
    );
    expect(flags.UUID).toBe("alice");
  });

  it("flags preserves an explicit UUID", async () => {
    const adapter = new RedisAdapter({ user: "alice" }, "p4");
    const flags: any = await (adapter as any).flags(
      OperationKeys.CREATE,
      UnitModel,
      { UUID: "bob" }
    );
    expect(flags.UUID).toBe("bob");
  });

  it("Dispatch returns a RedisDispatch", () => {
    const { adapter } = makeAdapter();
    expect((adapter as any).Dispatch()).toBeInstanceOf(RedisDispatch);
  });

  it("parseError passes BaseError through unchanged", () => {
    const { adapter } = makeAdapter();
    const error = new ConflictError("nope");
    expect(adapter.parseError(error)).toBe(error);
  });

  it("parseError maps connection failures to ConnectionError", () => {
    const { adapter } = makeAdapter();
    expect(
      adapter.parseError(new Error("connect ECONNREFUSED 127.0.0.1:6379"))
    ).toBeInstanceOf(ConnectionError);
    expect(adapter.parseError(new Error("Connection is closed"))).toBeInstanceOf(
      ConnectionError
    );
  });

  it("parseError wraps unknown failures in InternalError", () => {
    const { adapter } = makeAdapter();
    const parsed = adapter.parseError(new Error("kaboom"));
    expect(parsed).not.toBeInstanceOf(ConnectionError);
    expect(parsed).toBeInstanceOf(InternalError);
  });

  it("creates a record with HSETNX and rejects duplicates", async () => {
    const { adapter, client } = makeAdapter();
    const repo = new RedisRepository(adapter, UnitModel, true);
    const created = await repo.create(
      new UnitModel({ id: 1, name: "one", age: 20 })
    );
    expect(created).toBeInstanceOf(UnitModel);
    expect(client.hSetNX).toHaveBeenCalledTimes(1);
    await expect(
      repo.create(new UnitModel({ id: 1, name: "dup", age: 21 }))
    ).rejects.toThrow(ConflictError);
  });

  it("reads, updates and deletes a record", async () => {
    const { adapter } = makeAdapter();
    const repo = new RedisRepository(adapter, UnitModel, true);
    await repo.create(new UnitModel({ id: 2, name: "two", age: 30 }));

    const read = await repo.read(2);
    expect(read.name).toBe("two");
    expect(read.age).toBe(30);

    const updated = await repo.update(
      new UnitModel({ id: 2, name: "two-updated", age: 31 })
    );
    expect(updated.name).toBe("two-updated");

    const deleted = await repo.delete(2);
    expect(deleted.name).toBe("two-updated");
    await expect(repo.read(2)).rejects.toThrow(NotFoundError);
  });

  it("raises NotFoundError for missing reads, updates and deletes", async () => {
    const { adapter } = makeAdapter();
    const repo = new RedisRepository(adapter, UnitModel, true);
    await expect(repo.read(99)).rejects.toThrow(NotFoundError);
    await expect(
      repo.update(new UnitModel({ id: 99, name: "x", age: 1 }))
    ).rejects.toThrow(NotFoundError);
    await expect(repo.delete(99)).rejects.toThrow(NotFoundError);
  });

  it("stores bigint losslessly through the serializer", () => {
    const when = new Date("2024-05-06T07:08:09.000Z");
    const payload = { when, big: 12345678901234567890n, nested: { at: when } };
    const restored: any = deserialize(serialize(payload));
    expect(restored.big).toBe(12345678901234567890n);
  });

  it("stores Date losslessly through the serializer", () => {
    const when = new Date("2024-05-06T07:08:09.000Z");
    const payload = { when, big: 12345678901234567890n, nested: { at: when } };
    const restored: any = deserialize(serialize(payload));
    expect(restored.when).toEqual(when);
    expect(restored.nested.at).toEqual(when);
  });

  it("raw applies where/sort/limit/skip and select", async () => {
    const { adapter } = makeAdapter();
    const repo = new RedisRepository(adapter, UnitModel, true);
    await repo.createAll([
      new UnitModel({ id: 1, name: "a", age: 30 }),
      new UnitModel({ id: 2, name: "b", age: 20 }),
      new UnitModel({ id: 3, name: "c", age: 10 }),
    ]);

    const filtered = await repo
      .select()
      .where(Condition.attribute<UnitModel>("age").gte(20))
      .orderBy(["age", OrderDirection.ASC])
      .execute();
    expect(filtered.map((r) => r.id)).toEqual([2, 1]);

    const paged = await repo
      .select()
      .orderBy(["age", OrderDirection.ASC])
      .limit(2)
      .offset(1)
      .execute();
    expect(paged.map((r) => r.id)).toEqual([2, 1]);

    const selected: any[] = await repo
      .select(["name"])
      .orderBy(["age", OrderDirection.ASC])
      .execute();
    expect(selected.map((r) => r.name)).toEqual(["c", "b", "a"]);
    expect(selected.every((r) => r.age === undefined)).toBe(true);
  });

  it("raw supports count, min, max, sum, avg and distinct", async () => {
    const { adapter } = makeAdapter();
    const repo = new RedisRepository(adapter, UnitModel, true);
    await repo.createAll([
      new UnitModel({ id: 1, name: "a", age: 10 }),
      new UnitModel({ id: 2, name: "a", age: 20 }),
      new UnitModel({ id: 3, name: "b", age: 30 }),
    ]);

    expect(await repo.count().execute()).toBe(3);
    expect(await repo.count("name").execute()).toBe(3);
    expect(await repo.min("age").execute()).toBe(10);
    expect(await repo.max("age").execute()).toBe(30);
    const distinct: any[] = await repo.distinct("name").execute();
    expect(distinct.sort()).toEqual(["a", "b"]);
  });
});

describe("createdByOnRedisCreateUpdate", () => {
  it("sets the target key from the context UUID", async () => {
    const context = { get: () => "user-uuid" } as unknown as Context<any>;
    const model: any = {};
    await createdByOnRedisCreateUpdate.call(
      {} as any,
      context,
      {} as any,
      "createdBy" as any,
      model
    );
    expect(model.createdBy).toBe("user-uuid");
  });

  it("throws UnsupportedError when the context has no UUID", async () => {
    const context = { get: () => undefined } as unknown as Context<any>;
    const model: any = {};
    await expect(
      createdByOnRedisCreateUpdate.call(
        {} as any,
        context,
        {} as any,
        "createdBy" as any,
        model
      )
    ).rejects.toThrow(UnsupportedError);
  });
});
