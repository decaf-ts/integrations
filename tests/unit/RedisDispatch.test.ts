import { describe, it, expect, beforeEach, jest } from "@jest/globals";
import { Context } from "@decaf-ts/core";
import { Logging } from "@decaf-ts/logging";
import { OperationKeys } from "@decaf-ts/db-decorators";
import { RedisAdapter, RedisDefaultPrefix } from "../../src/redis";
import { RedisDispatch } from "../../src/redis/RedisDispatch";
import { RedisEventsChannel } from "../../src/redis/constants";
import { createFakeRedisClient } from "../helpers/redisFakeClient";

function makeDispatch() {
  const client = createFakeRedisClient();
  const adapter = new RedisAdapter(
    { url: "redis://localhost:6379", prefix: `${RedisDefaultPrefix}:unit-dispatch` },
    `dispatch-${Math.random()}`
  );
  (adapter as any)._client = client;
  const refresh = jest
    .spyOn(adapter, "refresh")
    .mockImplementation(async () => undefined as any);
  const dispatch = new RedisDispatch();
  (dispatch as any).adapter = adapter;
  return { dispatch, adapter, client, refresh };
}

describe("RedisDispatch unit behaviour", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("initializes an active subscriber on the duplicate connection", async () => {
    const { dispatch, client } = makeDispatch();
    await (dispatch as any).initialize();
    expect((dispatch as any).active).toBe(true);
    expect((dispatch as any).subscriber).toBeDefined();
    expect(client.duplicate).toHaveBeenCalledTimes(1);
    expect((dispatch as any).subscriber.subscribe).toHaveBeenCalledWith(
      RedisEventsChannel,
      expect.any(Function)
    );
  });

  it("publishes a change event and refreshes local observers", async () => {
    const { dispatch, client, refresh } = makeDispatch();
    await (dispatch as any).initialize();
    const ctx = new Context().accumulate({
      logger: Logging.get(),
      operation: OperationKeys.CREATE,
      observeFullResult: false,
    } as any);
    await dispatch.updateObservers("tst_user", OperationKeys.CREATE, 7, ctx);

    expect(refresh).toHaveBeenCalled();
    expect(client.publish).toHaveBeenCalledWith(
      RedisEventsChannel,
      expect.stringContaining('"table":"tst_user"')
    );
    expect(client.publish).toHaveBeenCalledWith(
      RedisEventsChannel,
      expect.stringContaining('"event":"create"')
    );
  });

  it("ignores the echo of its own published events", async () => {
    const { dispatch, refresh } = makeDispatch();
    await (dispatch as any).initialize();
    const own = (dispatch as any).origin;

    await (dispatch as any).changeHandler(
      JSON.stringify({
        origin: own,
        table: "tst_user",
        event: OperationKeys.UPDATE,
        id: 1,
      })
    );

    expect(refresh).not.toHaveBeenCalled();
  });

  it("refreshes observers for remote events", async () => {
    const { dispatch, refresh } = makeDispatch();
    await (dispatch as any).initialize();

    await (dispatch as any).changeHandler(
      JSON.stringify({
        origin: "some-other-process",
        table: "tst_user",
        event: OperationKeys.UPDATE,
        id: 1,
      })
    );

    expect(refresh).toHaveBeenCalledWith(
      "tst_user",
      OperationKeys.UPDATE,
      1,
      expect.anything()
    );
  });

  it("ignores malformed payloads", async () => {
    const { dispatch, refresh } = makeDispatch();
    await (dispatch as any).initialize();
    await (dispatch as any).changeHandler("{not-json}");
    expect(refresh).not.toHaveBeenCalled();
  });

  it("deactivates on close and releases the subscriber", async () => {
    const { dispatch } = makeDispatch();
    await (dispatch as any).initialize();
    const subscriber = (dispatch as any).subscriber;
    await dispatch.close();
    expect((dispatch as any).active).toBe(false);
    expect((dispatch as any).subscriber).toBeUndefined();
    expect(subscriber.unsubscribe).toHaveBeenCalledWith(RedisEventsChannel);
    expect(subscriber.quit).toHaveBeenCalled();
  });
});
