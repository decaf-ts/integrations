import { describe, it, expect, beforeAll, afterAll, jest } from "@jest/globals";
import { BaseModel, Observer, pk } from "@decaf-ts/core";
import { uses } from "@decaf-ts/decoration";
import { Model, model, type ModelArg } from "@decaf-ts/decorator-validation";
import {
  RedisDispatch,
  RedisFlavour,
  RedisRepository,
} from "../../src/redis";
import {
  cleanupRedisTestResources,
  setupRedisAdapter,
  RedisTestResources,
} from "../helpers/redis";

Model.setBuilder(Model.fromModel);

@uses(RedisFlavour)
@model()
class DispatchRedisModel extends BaseModel {
  @pk({ type: Number, generated: false })
  id!: number;

  name!: string;

  constructor(arg?: ModelArg<DispatchRedisModel>) {
    super(arg);
  }
}

jest.setTimeout(60000);

function waitFor(
  predicate: () => boolean,
  timeoutMs = 10000,
  intervalMs = 25
): Promise<void> {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + timeoutMs;
    const tick = () => {
      if (predicate()) return resolve();
      if (Date.now() > deadline)
        return reject(new Error("condition not met before timeout"));
      return setTimeout(tick, intervalMs);
    };
    tick();
  });
}

describe("RedisDispatch integration", () => {
  let resources: RedisTestResources;
  let remote: RedisTestResources;
  let repo: RedisRepository<DispatchRedisModel>;
  let remoteRepo: RedisRepository<DispatchRedisModel>;

  beforeAll(async () => {
    resources = await setupRedisAdapter("dispatch", "redis-dispatch-a");
    remote = await setupRedisAdapter("dispatch-remote", "redis-dispatch-b");
    repo = new RedisRepository(resources.adapter, DispatchRedisModel, true);
    remoteRepo = new RedisRepository(
      remote.adapter,
      DispatchRedisModel,
      true
    );
  });

  afterAll(async () => {
    await cleanupRedisTestResources(resources);
    await cleanupRedisTestResources(remote);
  });

  it("refreshes remote observers when a record is published", async () => {
    const observerA: Observer = { refresh: () => Promise.resolve() };
    const observerB: Observer = { refresh: () => Promise.resolve() };
    const unobserveA = repo.observe(observerA);
    const unobserveB = remoteRepo.observe(observerB);

    const localDispatch = (resources.adapter as any).dispatch as RedisDispatch;
    const remoteDispatch = (remote.adapter as any).dispatch as RedisDispatch;
    await waitFor(() => (localDispatch as any).active === true);
    await waitFor(() => (remoteDispatch as any).active === true);

    const refreshed: string[] = [];
    jest.spyOn(observerB, "refresh").mockImplementation(async () => {
      refreshed.push("b");
      return undefined as any;
    });

    await repo.create(
      new DispatchRedisModel({
        id: 100,
        name: "remote",
        age: 1,
        active: true,
        score: 1,
      })
    );

    await waitFor(() => refreshed.length > 0);
    expect(refreshed.length).toBeGreaterThan(0);

    unobserveA();
    unobserveB();
    await (remote.adapter as any).dispatch?.close();
  });

  it("marks the dispatch active when observing and flips when closed", async () => {
    const observer: Observer = { refresh: () => Promise.resolve() };
    const unobserve = repo.observe(observer);

    const dispatch = (resources.adapter as any).dispatch as RedisDispatch;
    expect(dispatch).toBeDefined();
    await waitFor(() => (dispatch as any).active === true);
    expect((dispatch as any).active).toBe(true);

    await dispatch.close();
    expect((dispatch as any).active).toBe(false);
    expect((dispatch as any).subscriber).toBeUndefined();

    unobserve();
  });
});
