import { describe, it, expect, beforeAll, afterAll, jest } from "@jest/globals";
import { BaseModel, pk, sequence, version } from "@decaf-ts/core";
import { uses } from "@decaf-ts/decoration";
import { Model, model, type ModelArg } from "@decaf-ts/decorator-validation";
import { RedisFlavour } from "../../src/redis";
import {
  cleanupRedisTestResources,
  redisRepository,
  setupRedisAdapter,
  RedisTestResources,
} from "../helpers/redis";

Model.setBuilder(Model.fromModel);

jest.setTimeout(60000);

@uses(RedisFlavour)
@model()
class PersistentVersionRedisModel extends BaseModel {
  @pk({ type: Number, generated: false })
  id!: number;

  @version(true)
  version!: number;

  constructor(arg?: ModelArg<PersistentVersionRedisModel>) {
    super(arg);
  }
}

@uses(RedisFlavour)
@model()
class SequencePerInstanceRedisModel extends BaseModel {
  @pk({ type: Number, generated: false })
  id!: number;

  @sequence({ type: Number })
  step!: number;

  constructor(arg?: ModelArg<SequencePerInstanceRedisModel>) {
    super(arg);
  }
}

@uses(RedisFlavour)
@model()
class GeneratedPkRedisModel extends BaseModel {
  @pk()
  id!: number;

  name!: string;

  constructor(arg?: ModelArg<GeneratedPkRedisModel>) {
    super(arg);
  }
}

describe("core decorators on the Redis adapter", () => {
  let resources: RedisTestResources;

  beforeAll(async () => {
    resources = await setupRedisAdapter("decorators");
  });

  afterAll(async () => {
    await cleanupRedisTestResources(resources);
  });

  it("@version() increments across update/delete/recreate for the same pk", async () => {
    const repo = redisRepository(resources.adapter, PersistentVersionRedisModel);

    const created = await repo.create(
      new PersistentVersionRedisModel({ id: 1 })
    );
    expect(created.version).toBe(1);

    const updated = await repo.update(
      new PersistentVersionRedisModel({ ...created })
    );
    expect(updated.version).toBe(2);

    await repo.delete(updated.id);

    const recreated = await repo.create(
      new PersistentVersionRedisModel({ id: 1 })
    );
    expect(recreated.version).toBe(3);

    const another = await repo.create(
      new PersistentVersionRedisModel({ id: 2 })
    );
    expect(another.version).toBe(1);
  });

  it("@sequence() is per-model-instance (pk + property), not global per class", async () => {
    const repo = redisRepository(
      resources.adapter,
      SequencePerInstanceRedisModel
    );

    let a = await repo.create(new SequencePerInstanceRedisModel({ id: 1 }));
    let b = await repo.create(new SequencePerInstanceRedisModel({ id: 2 }));

    expect(a.step).toBe(1);
    expect(b.step).toBe(1);

    a = await repo.delete(1);
    b = await repo.update(b);

    expect(a.step).toBe(1);
    expect(b.step).toBe(1);

    a = await repo.create(new SequencePerInstanceRedisModel({ id: 1 }));
    delete b.step;
    b = await repo.update(b);

    expect(a.step).toBe(2);
    expect(b.step).toBe(1);
  });

  it("generates sequential primary keys through the adapter sequence", async () => {
    const repo = redisRepository(resources.adapter, GeneratedPkRedisModel);
    const first = await repo.create(new GeneratedPkRedisModel({ name: "a" }));
    const second = await repo.create(new GeneratedPkRedisModel({ name: "b" }));

    expect(typeof first.id).toBe("number");
    expect(typeof second.id).toBe("number");
    expect(second.id).toBeGreaterThan(first.id);
  });
});
