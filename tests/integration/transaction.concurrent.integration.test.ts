/**
 * @description Tests for simultaneous transactions against live DragonflyDB
 * @summary Verifies the Redis adapter's optimistic transaction semantics:
 * - writes buffered inside a transaction are invisible to a separate connection
 *   until commit, and
 * - a commit whose watched record changed concurrently aborts with a
 *   `ConflictError` instead of silently overwriting the other write.
 * Redis has no row locks, so (unlike the TypeORM port) this does NOT assert
 * "blocks until commit" - it asserts optimistic conflict detection.
 */
import { describe, it, expect, beforeAll, afterAll, jest } from "@jest/globals";
import { BaseModel, Context, pk, table, transactional } from "@decaf-ts/core";
import { Logging } from "@decaf-ts/logging";
import { uses } from "@decaf-ts/decoration";
import {
  ConflictError,
  NotFoundError,
  OperationKeys,
} from "@decaf-ts/db-decorators";
import {
  Model,
  model,
  type ModelArg,
  required,
} from "@decaf-ts/decorator-validation";
import { RedisAdapter, RedisFlavour, RedisRepository } from "../../src/redis";
import {
  cleanupRedisTestResources,
  setupRedisAdapter,
  RedisTestResources,
} from "../helpers/redis";

Model.setBuilder(Model.fromModel);

jest.setTimeout(60000);

@uses(RedisFlavour)
@table("tst_redis_tx")
@model()
class ConcurrentTxModel extends BaseModel {
  @pk({ type: String, generated: false })
  id!: string;

  @required()
  name!: string;

  constructor(arg?: ModelArg<ConcurrentTxModel>) {
    super(arg);
  }
}

class ConcurrentTxRepository extends RedisRepository<ConcurrentTxModel> {
  onHeld?: () => void;
  gate?: Promise<void>;

  constructor(adapter: RedisAdapter, force = false) {
    super(adapter, ConcurrentTxModel, force);
  }

  @transactional()
  async createAndHold(
    toCreate: ConcurrentTxModel,
    ...args: any[]
  ): Promise<ConcurrentTxModel> {
    const created = await this.create(toCreate, ...args);
    this.onHeld?.();
    await this.gate;
    return created;
  }
}

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

describe("simultaneous transactions against live DragonflyDB", () => {
  let resources: RedisTestResources;
  let verify: RedisTestResources;
  let repo: ConcurrentTxRepository;

  beforeAll(async () => {
    resources = await setupRedisAdapter("tx-concurrent", "redis-tx");
    const verifyAdapter = new RedisAdapter(
      { url: resources.url, prefix: resources.prefix },
      "redis-tx-verify"
    );
    await verifyAdapter.initialize();
    verify = {
      adapter: verifyAdapter,
      prefix: resources.prefix,
      url: resources.url,
    };
    repo = new ConcurrentTxRepository(resources.adapter);
  });

  afterAll(async () => {
    await cleanupRedisTestResources(resources);
    await cleanupRedisTestResources(verify);
  });

  it("hides a buffered write from another connection until commit", async () => {
    const held = deferred();
    const gate = deferred();
    repo.onHeld = held.resolve;
    repo.gate = gate.promise;

    const txPromise = repo.createAndHold(
      new ConcurrentTxModel({ id: "101", name: "hidden-until-commit" })
    );

    await held.promise;

    const verifyRepo = new RedisRepository(
      verify.adapter,
      ConcurrentTxModel,
      true
    );
    await expect(verifyRepo.read("101")).rejects.toThrow(NotFoundError);

    gate.resolve();
    const result = await txPromise;
    expect(result.name).toBe("hidden-until-commit");

    const read = await verifyRepo.read("101");
    expect(read.name).toBe("hidden-until-commit");
  });

  it("does not silently overwrite a concurrently changed record", async () => {
    const { lock, ctx, repo: externalRepo } = await prepareConflict(
      resources,
      verify,
      "102"
    );

    await expect(lock.commit(ctx)).rejects.toThrow();

    const final = await externalRepo.read("102");
    expect(final.name).toBe("txn-b");
  });

  it("raises ConflictError when a watched record changes before commit", async () => {
    const { lock, ctx } = await prepareConflict(resources, verify, "103");
    await expect(lock.commit(ctx)).rejects.toThrow(ConflictError);
  });
});

async function prepareConflict(
  resources: RedisTestResources,
  verify: RedisTestResources,
  id: string
): Promise<{
  lock: any;
  ctx: Context;
  repo: RedisRepository<ConcurrentTxModel>;
}> {
  const setupRepo = new RedisRepository(
    resources.adapter,
    ConcurrentTxModel,
    true
  );
  await setupRepo.create(new ConcurrentTxModel({ id, name: "initial" }));

  const lock = resources.adapter.transactionLock() as any;
  const ctx = new Context().accumulate({
    logger: Logging.get(),
    operation: OperationKeys.UPDATE,
  } as any);
  await lock.begin(ctx);
  ctx.cache.put("transactionLock", lock);

  await resources.adapter.update(
    ConcurrentTxModel,
    id,
    { id, name: "txn-a" },
    ctx
  );

  const externalRepo = new RedisRepository(
    verify.adapter,
    ConcurrentTxModel,
    true
  );
  const txClient = lock.txClient;
  const originalWatch = txClient.watch.bind(txClient);
  txClient.watch = async (keys: string[]) => {
    const watched = await originalWatch(keys);
    await externalRepo.update(
      new ConcurrentTxModel({ id, name: "txn-b" })
    );
    return watched;
  };
  return { lock, ctx, repo: externalRepo };
}
