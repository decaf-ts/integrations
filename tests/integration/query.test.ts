import { describe, it, expect, beforeAll, afterAll, jest } from "@jest/globals";
import { BaseModel, Condition, column, pk, table } from "@decaf-ts/core";
import {
  Model,
  model,
  type ModelArg,
  required,
} from "@decaf-ts/decorator-validation";
import { uses } from "@decaf-ts/decoration";
import { RedisFlavour, RedisRepository } from "../../src/redis";
import {
  cleanupRedisTestResources,
  setupRedisAdapter,
  RedisTestResources,
} from "../helpers/redis";
import { people, RedisPersonModel } from "./models";

Model.setBuilder(Model.fromModel);

jest.setTimeout(60000);

@uses(RedisFlavour)
@table("tst_redis_exists_person")
@model()
class RedisExistsPersonModel extends BaseModel {
  @pk({ type: Number, generated: false })
  id!: number;

  @required()
  name!: string;

  @column("nickname")
  nickname?: string;

  constructor(m?: ModelArg<RedisExistsPersonModel>) {
    super(m);
  }
}

describe("Redis query", () => {
  let resources: RedisTestResources;
  let repo: RedisRepository<RedisPersonModel>;

  beforeAll(async () => {
    resources = await setupRedisAdapter("query");
    repo = new RedisRepository(resources.adapter, RedisPersonModel);
    await repo.createAll(people());
  });

  afterAll(async () => {
    await cleanupRedisTestResources(resources);
  });

  it("finds records with equality conditions", async () => {
    const found = await repo
      .select()
      .where(Condition.attribute<RedisPersonModel>("name").eq("alice"))
      .execute();
    expect(found).toHaveLength(1);
    expect(found[0].name).toBe("alice");
  });

  it("supports comparison operators", async () => {
    const gt = await repo
      .select()
      .where(Condition.attribute<RedisPersonModel>("age").gt(20))
      .execute();
    expect(gt.map((p) => p.name).sort()).toEqual(["alice", "carol"]);

    const between = await repo
      .select()
      .where(Condition.attribute<RedisPersonModel>("age").between(15, 35))
      .execute();
    expect(between.map((p) => p.name).sort()).toEqual(["alice", "bob"]);
  });

  it("supports membership and string operators", async () => {
    const inOp = await repo
      .select()
      .where(
        Condition.attribute<RedisPersonModel>("name").in(["alice", "dave"])
      )
      .execute();
    expect(inOp.map((p) => p.name).sort()).toEqual(["alice", "dave"]);

    const starts = await repo
      .select()
      .where(Condition.attribute<RedisPersonModel>("name").startsWith("c"))
      .execute();
    expect(starts.map((p) => p.name)).toEqual(["carol"]);

    const ends = await repo
      .select()
      .where(Condition.attribute<RedisPersonModel>("name").endsWith("e"))
      .execute();
    expect(ends.map((p) => p.name).sort()).toEqual(["alice", "dave"]);
  });

  it("supports boolean and logical conditions", async () => {
    const and = await repo
      .select()
      .where(
        Condition.and(
          Condition.attribute<RedisPersonModel>("active").eq(true),
          Condition.attribute<RedisPersonModel>("age").gt(20)
        )
      )
      .execute();
    expect(and.map((p) => p.name)).toEqual(["alice", "carol"]);

    const or = await repo
      .select()
      .where(
        Condition.or(
          Condition.attribute<RedisPersonModel>("name").eq("bob"),
          Condition.attribute<RedisPersonModel>("name").eq("dave")
        )
      )
      .execute();
    expect(or.map((p) => p.name).sort()).toEqual(["bob", "dave"]);
  });

  it("supports aggregations and distinct", async () => {
    expect(await repo.count().execute()).toBe(4);
    expect(await repo.min("age").execute()).toBe(10);
    expect(await repo.max("age").execute()).toBe(40);
    expect(await repo.sum("age").execute()).toBe(100);
    expect(await repo.avg("age").execute()).toBe(25);

    const distinct: any[] = await repo.distinct("active").execute();
    expect(distinct.sort()).toEqual([false, true]);
  });

  it("returns an empty result when nothing matches", async () => {
    const none = await repo
      .select()
      .where(Condition.attribute<RedisPersonModel>("age").gt(1000))
      .execute();
    expect(none).toEqual([]);
  });

  it("supports the EXISTS operator", async () => {
    const present = await repo
      .select()
      .where(Condition.attribute<RedisPersonModel>("name").exists())
      .execute();
    expect(present.map((p) => p.name).sort()).toEqual([
      "alice",
      "bob",
      "carol",
      "dave",
    ]);

    const absent = await repo
      .select()
      .where(Condition.attribute<RedisPersonModel>("name").exists(false))
      .execute();
    expect(absent).toEqual([]);
  });

  it("supports the REGEXP operator", async () => {
    const found = await repo
      .select()
      .where(Condition.attribute<RedisPersonModel>("name").regexp("^[ab]"))
      .execute();
    expect(found.map((p) => p.name).sort()).toEqual(["alice", "bob"]);
  });

  it("supports the DIFFERENT operator", async () => {
    const found = await repo
      .select()
      .where(Condition.attribute<RedisPersonModel>("name").dif("alice"))
      .execute();
    expect(found.map((p) => p.name).sort()).toEqual(["bob", "carol", "dave"]);
  });

  it("supports the SMALLER and SMALLER_EQ operators", async () => {
    const lt = await repo
      .select()
      .where(Condition.attribute<RedisPersonModel>("age").lt(20))
      .execute();
    expect(lt.map((p) => p.name)).toEqual(["dave"]);

    const lte = await repo
      .select()
      .where(Condition.attribute<RedisPersonModel>("age").lte(20))
      .execute();
    expect(lte.map((p) => p.name).sort()).toEqual(["bob", "dave"]);
  });

  describe("EXISTS mixed dataset", () => {
    let existsResources: RedisTestResources;
    let existsRepo: RedisRepository<RedisExistsPersonModel>;

    const WITH_NICKNAME = [1, 2, 3, 4, 5, 6];
    const WITHOUT_NICKNAME = [11, 12, 13, 14];

    beforeAll(async () => {
      existsResources = await setupRedisAdapter("query-exists", "query-exists");
      existsRepo = new RedisRepository(
        existsResources.adapter,
        RedisExistsPersonModel
      );
      await existsRepo.createAll([
        ...WITH_NICKNAME.map(
          (id) =>
            new RedisExistsPersonModel({
              id,
              name: `name_${id}`,
              nickname: `nick_${id}`,
            })
        ),
        ...WITHOUT_NICKNAME.map(
          (id) => new RedisExistsPersonModel({ id, name: `name_${id}` })
        ),
      ]);
    });

    afterAll(async () => {
      await cleanupRedisTestResources(existsResources);
    });

    const ids = (records: RedisExistsPersonModel[]) =>
      records.map((r) => r.id).sort();

    it("returns exactly the records that define the optional attribute", async () => {
      const present = await existsRepo
        .select()
        .where(Condition.attribute<RedisExistsPersonModel>("nickname").exists())
        .execute();
      expect(ids(present)).toEqual([...WITH_NICKNAME].sort());

      const absent = await existsRepo
        .select()
        .where(
          Condition.attribute<RedisExistsPersonModel>("nickname").exists(false)
        )
        .execute();
      expect(ids(absent)).toEqual([...WITHOUT_NICKNAME].sort());
    });

    it("runs EXISTS through the complex-condition path combined with another predicate", async () => {
      const combined = await existsRepo
        .select()
        .where(
          Condition.attribute<RedisExistsPersonModel>("nickname")
            .exists()
            .and(Condition.attribute<RedisExistsPersonModel>("name").exists())
        )
        .execute();
      expect(ids(combined)).toEqual([...WITH_NICKNAME].sort());

      const narrowed = await existsRepo
        .select()
        .where(
          Condition.attribute<RedisExistsPersonModel>("nickname")
            .exists()
            .and(Condition.attribute<RedisExistsPersonModel>("id").lte(3))
        )
        .execute();
      expect(ids(narrowed)).toEqual([1, 2, 3]);
    });
  });
});
