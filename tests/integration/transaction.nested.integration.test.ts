/**
 * @description Tests for nested @transactional calls against live DragonflyDB
 * @summary Verifies that a nested `@transactional()` call reuses the outer
 * transaction's {@link RedisContextLock} (one dedicated Redis connection and one
 * write buffer) and that a failure at any level rolls back every buffered write
 * from all levels.
 */
import { describe, it, expect, beforeAll, afterAll, jest } from "@jest/globals";
import {
  BaseModel,
  pk,
  Repository,
  table,
  transactional,
} from "@decaf-ts/core";
import { uses } from "@decaf-ts/decoration";
import { NotFoundError } from "@decaf-ts/db-decorators";
import {
  Model,
  model,
  type ModelArg,
  required,
} from "@decaf-ts/decorator-validation";
import { RedisAdapter, RedisFlavour } from "../../src/redis";
import {
  cleanupRedisTestResources,
  setupRedisAdapter,
  RedisTestResources,
} from "../helpers/redis";

Model.setBuilder(Model.fromModel);

jest.setTimeout(60000);

@uses(RedisFlavour)
@table("tst_redis_nested_tx")
@model()
class NestedTxModel extends BaseModel {
  @pk({ type: String, generated: false })
  id!: string;

  @required()
  name!: string;

  constructor(arg?: ModelArg<NestedTxModel>) {
    super(arg);
  }
}

class NestedTxRepository extends Repository<NestedTxModel, RedisAdapter> {
  constructor(adapter: RedisAdapter, force = false) {
    super(adapter, NestedTxModel, force);
  }

  @transactional()
  async innerCreate(
    toCreate: NestedTxModel,
    ...args: any[]
  ): Promise<NestedTxModel> {
    return this.create(toCreate, ...args);
  }

  @transactional()
  async outerCreate(
    outer: NestedTxModel,
    inner: NestedTxModel,
    fail: boolean,
    ...args: any[]
  ): Promise<{ outer: NestedTxModel; inner: NestedTxModel; seen: boolean }> {
    const createdOuter = await this.create(outer, ...args);
    const createdInner = await this.innerCreate(inner, ...args);
    let seen = false;
    try {
      const buffered = await this.read(inner.id, ...args);
      seen = buffered.name === inner.name;
    } catch {
      seen = false;
    }
    if (fail) throw new Error("outer failure");
    return { outer: createdOuter, inner: createdInner, seen };
  }
}

describe("nested @transactional calls against live DragonflyDB", () => {
  let resources: RedisTestResources;
  let verify: RedisTestResources;
  let repo: NestedTxRepository;

  beforeAll(async () => {
    resources = await setupRedisAdapter("tx-nested", "redis-tx-nested");
    const verifyAdapter = new RedisAdapter(
      { url: resources.url, prefix: resources.prefix },
      "redis-tx-nested-verify"
    );
    await verifyAdapter.initialize();
    verify = {
      adapter: verifyAdapter,
      prefix: resources.prefix,
      url: resources.url,
    };
    repo = new NestedTxRepository(resources.adapter);
  });

  afterAll(async () => {
    await cleanupRedisTestResources(resources);
    await cleanupRedisTestResources(verify);
  });

  it("commits every level of a successful nested transaction", async () => {
    const result = await repo.outerCreate(
      new NestedTxModel({ id: "201", name: "outer" }),
      new NestedTxModel({ id: "202", name: "inner" }),
      false
    );
    expect(result.seen).toBe(true);
    expect(result.outer.name).toBe("outer");
    expect(result.inner.name).toBe("inner");

    const verifyRepo = new Repository(
      verify.adapter,
      NestedTxModel,
      true
    );
    expect((await verifyRepo.read("201")).name).toBe("outer");
    expect((await verifyRepo.read("202")).name).toBe("inner");
  });

  it("rolls back every level when the outer frame fails", async () => {
    const verifyRepo = new Repository(
      verify.adapter,
      NestedTxModel,
      true
    );
    await expect(
      repo.outerCreate(
        new NestedTxModel({ id: "203", name: "outer-fail" }),
        new NestedTxModel({ id: "204", name: "inner-fail" }),
        true
      )
    ).rejects.toThrow("outer failure");

    await expect(verifyRepo.read("203")).rejects.toThrow(NotFoundError);
    await expect(verifyRepo.read("204")).rejects.toThrow(NotFoundError);
  });
});
