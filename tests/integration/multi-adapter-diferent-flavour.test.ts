import { describe, it, expect, beforeAll, afterAll, jest } from "@jest/globals";
import { Adapter, createdBy, pk, Repository } from "@decaf-ts/core";
import { RamAdapter, RamFlavour } from "@decaf-ts/core/ram";
import { uses } from "@decaf-ts/decoration";
import {
  Model,
  model,
  type ModelArg,
  required,
} from "@decaf-ts/decorator-validation";
import { RedisFlavour, RedisRepository } from "../../src/redis";
import {
  cleanupRedisTestResources,
  setupRedisAdapter,
  RedisTestResources,
} from "../helpers/redis";

RamAdapter.decoration();
Adapter.setCurrent(RamFlavour);

Model.setBuilder(Model.fromModel);

jest.setTimeout(60000);

@uses(RamFlavour)
@model()
class RamModel extends Model {
  @pk({ type: Number, generated: false })
  id!: number;

  @required()
  name!: string;

  @createdBy()
  owner!: string;

  constructor(arg?: ModelArg<RamModel>) {
    super(arg);
  }
}

@uses(RedisFlavour)
@model()
class RedisModel extends Model {
  @pk({ type: Number, generated: false })
  id!: number;

  @required()
  name!: string;

  @createdBy()
  owner!: string;

  constructor(arg?: ModelArg<RedisModel>) {
    super(arg);
  }
}

describe("Redis and RAM adapters coexist", () => {
  let resources: RedisTestResources;
  let ram: RamAdapter;

  beforeAll(async () => {
    resources = await setupRedisAdapter("multi-flavour", "redis-flavour");
    ram = new RamAdapter();
    await ram.initialize();
  });

  afterAll(async () => {
    await cleanupRedisTestResources(resources);
    await ram.shutdown();
  });

  it("resolves the adapter declared by each model", () => {
    const ramRepo = Repository.forModel(RamModel);
    expect(ramRepo["adapter"]).toBeInstanceOf(RamAdapter);

    const redisRepo = Repository.forModel(
      RedisModel,
      resources.adapter.alias
    ) as RedisRepository<RedisModel>;
    expect(redisRepo.adapter.flavour).toBe(RedisFlavour);
    expect(redisRepo.adapter).not.toBeInstanceOf(RamAdapter);
  });

  it("creates records through the correct flavour", async () => {
    const ramRepo = Repository.forModel(RamModel);
    const redisRepo = Repository.forModel(
      RedisModel,
      resources.adapter.alias
    ) as RedisRepository<RedisModel>;

    const createdRam = await ramRepo.create(
      new RamModel({ id: 1, name: "ram-record" })
    );
    expect(createdRam.name).toBe("ram-record");

    const createdRedis = await redisRepo.create(
      new RedisModel({ id: 2, name: "redis-record" })
    );
    expect(createdRedis.name).toBe("redis-record");

    expect((await ramRepo.read(1)).name).toBe("ram-record");
    expect((await redisRepo.read(2)).name).toBe("redis-record");
  });
});
