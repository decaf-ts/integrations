import { describe, it, expect, beforeAll, afterAll, jest } from "@jest/globals";
import { repository, Repository } from "@decaf-ts/core";
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

describe("Redis repositories", () => {
  let resources: RedisTestResources;

  beforeAll(async () => {
    resources = await setupRedisAdapter("repository");
  });

  afterAll(async () => {
    await cleanupRedisTestResources(resources);
  });

  it("instantiates via constructor", () => {
    const repo = new Repository(resources.adapter, RedisCountryModel);
    expect(repo).toBeDefined();
    expect(repo).toBeInstanceOf(Repository);
  });

  it("instantiates via Repository.forModel with @uses decorator on the model", () => {
    const repo = Repository.forModel(RedisCountryModel);
    expect(repo).toBeDefined();
    expect(repo).toBeInstanceOf(Repository);
  });

  it("gets injected when using @repository", () => {
    class TestClass {
      @repository(RedisCountryModel)
      repo!: Repository<RedisCountryModel, RedisAdapter>;
    }

    const testClass = new TestClass();
    expect(testClass).toBeDefined();
    expect(testClass.repo).toBeDefined();
    expect(testClass.repo).toBeInstanceOf(Repository);
  });

  it("resolves the repository bound to the Redis adapter", () => {
    const repo = Repository.forModel(
      RedisCountryModel,
      resources.adapter.alias
    ) as Repository<RedisCountryModel, RedisAdapter>;
    expect(repo.adapter).toBe(resources.adapter);
  });
});
