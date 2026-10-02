import { describe, it, expect, beforeAll, afterAll, jest } from "@jest/globals";
import { BaseModel, pk, Repository } from "@decaf-ts/core";
import { uses } from "@decaf-ts/decoration";
import {
  minlength,
  Model,
  model,
  type ModelArg,
  required,
} from "@decaf-ts/decorator-validation";
import { NotFoundError } from "@decaf-ts/db-decorators";
import { RedisAdapter, RedisFlavour } from "../../src/redis";
import {
  cleanupRedisTestResources,
  setupRedisAdapter,
  RedisTestResources,
} from "../helpers/redis";

Model.setBuilder(Model.fromModel);

jest.setTimeout(60000);

@uses(RedisFlavour)
@model()
class BulkRedisModel extends BaseModel {
  @pk({ type: Number, generated: false })
  id?: number = undefined;

  @required()
  @minlength(5)
  attr1?: string = undefined;

  constructor(arg?: ModelArg<BulkRedisModel>) {
    super(arg);
  }
}

describe("Redis bulk operations", () => {
  let resources: RedisTestResources;
  let repo: Repository<BulkRedisModel, RedisAdapter>;

  beforeAll(async () => {
    resources = await setupRedisAdapter("bulk");
    repo = new Repository(resources.adapter, BulkRedisModel);
  });

  afterAll(async () => {
    await cleanupRedisTestResources(resources);
  });

  let created: BulkRedisModel[];
  let updated: BulkRedisModel[];

  it("creates records in bulk", async () => {
    const models = [1, 2, 3].map(
      (i) => new BulkRedisModel({ id: i, attr1: `user_name_${i}` })
    );
    created = await repo.createAll(models);
    expect(Array.isArray(created)).toBe(true);
    expect(created).toHaveLength(3);
    expect(created.every((el) => el instanceof BulkRedisModel)).toBe(true);
    expect(created.every((el) => !el.hasErrors())).toBe(true);
  });

  it("reads records in bulk", async () => {
    const ids = created.map((c) => c.id) as number[];
    const read = await repo.readAll(ids);
    expect(Array.isArray(read)).toBe(true);
    expect(read.every((el) => el instanceof BulkRedisModel)).toBe(true);
    expect(read.every((el, i) => el.equals(created[i]))).toBe(true);
  });

  it("updates records in bulk", async () => {
    const toUpdate = created.map(
      (c, i) => new BulkRedisModel({ id: c.id, attr1: `updated_name_${i}` })
    );
    updated = await repo.updateAll(toUpdate);
    expect(Array.isArray(updated)).toBe(true);
    expect(updated.every((el, i) => !el.equals(created[i]))).toBe(true);
  });

  it("deletes records in bulk", async () => {
    const ids = created.map((c) => c.id) as number[];
    const deleted = await repo.deleteAll(ids);
    expect(Array.isArray(deleted)).toBe(true);
    expect(deleted.every((el, i) => el.equals(updated[i]))).toBe(true);
    for (const id of ids) {
      await expect(repo.read(id)).rejects.toThrow(NotFoundError);
    }
  });
});
