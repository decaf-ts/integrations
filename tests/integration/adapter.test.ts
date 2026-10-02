import { describe, it, expect, beforeAll, afterAll, jest } from "@jest/globals";
import { Repository } from "@decaf-ts/core";
import { Model } from "@decaf-ts/decorator-validation";
import { NotFoundError } from "@decaf-ts/db-decorators";
import { RedisAdapter } from "../../src/redis";
import {
  cleanupRedisTestResources,
  redisRepository,
  setupRedisAdapter,
  RedisTestResources,
} from "../helpers/redis";
import { TestModel } from "../helpers/redisTestModel";

Model.setBuilder(Model.fromModel);

jest.setTimeout(60000);

describe("Redis adapter integration", () => {
  let resources: RedisTestResources;
  let repo: Repository<TestModel, RedisAdapter>;

  beforeAll(async () => {
    resources = await setupRedisAdapter("adapter");
    repo = redisRepository(resources.adapter, TestModel);
  });

  afterAll(async () => {
    await cleanupRedisTestResources(resources);
  });

  let created: TestModel;
  let updated: TestModel;

  it("creates a record", async () => {
    const model = new TestModel({
      id: Date.now(),
      name: "test_name",
      nif: "123456789",
    });
    created = await repo.create(model);
    expect(created).toBeDefined();
    expect(created).toBeInstanceOf(TestModel);
    expect(created.id).toBeDefined();
    expect(created.name).toBe("test_name");
    expect(created.nif).toBe("123456789");
    expect(created.createdBy).toEqual(expect.any(String));
  });

  it("reads a record", async () => {
    const read = await repo.read(created.id as number);
    expect(read).toBeDefined();
    expect(read instanceof TestModel).toBe(true);
    expect(read.equals(created)).toBe(true);
    expect(read === created).toBe(false);
  });

  it("updates a record", async () => {
    const toUpdate = new TestModel(
      Object.assign({}, created, { name: "new_test_name" })
    );
    updated = await repo.update(toUpdate);
    expect(updated).toBeDefined();
    expect(updated.id).toBe(created.id);
    expect(updated.name).toBe("new_test_name");
    expect(updated.equals(created)).toBe(false);
  });

  it("deletes a record", async () => {
    const deleted = await repo.delete(created.id as number);
    expect(deleted).toBeDefined();
    expect(deleted.id).toBe(created.id);
    await expect(repo.read(created.id as number)).rejects.toThrow(NotFoundError);
  });
});
