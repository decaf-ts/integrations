import { ContextualArgs, Dispatch } from "@decaf-ts/core";
import { BulkCrudOperationKeys, OperationKeys } from "@decaf-ts/db-decorators";
import { Model } from "@decaf-ts/decorator-validation";
import { randomUUID } from "crypto";
import type { RedisClientType } from "redis";
import { RedisEventsChannel } from "./constants";
import type { RedisAdapter } from "./adapter";
import type { RedisContext } from "./types";

/**
 * @description Dispatcher for Redis change events
 * @summary Extends the core `Dispatch` to broadcast record changes over Redis
 * pub/sub so that every process sharing the same database refreshes its observers.
 * Local observer updates are still performed synchronously through the base class;
 * the published message carries an `origin` id so a process ignores the echo of its
 * own events and never notifies its observers twice.
 * @class RedisDispatch
 * @category Redis
 */
export class RedisDispatch extends Dispatch<RedisAdapter> {
  private subscriber?: RedisClientType;
  private readonly origin = randomUUID();

  /**
   * @description Whether the pub/sub subscription is currently active
   */
  public active = false;

  /**
   * @description Initializes the dispatcher and opens the pub/sub subscription
   * @summary Proxies the adapter's CRUD methods through the base implementation,
   * then opens a dedicated subscriber connection listening for change events.
   * @param {...ContextualArgs} args - Contextual arguments
   * @return {Promise<void>} A promise that resolves once initialization is complete
   */
  protected override async initialize(
    ...args: ContextualArgs<RedisContext>
  ): Promise<void> {
    await super.initialize(...args);
    if (!this.adapter) return;
    try {
      const subscriber = this.adapter.client.duplicate() as RedisClientType;
      await subscriber.connect();
      await subscriber.subscribe(RedisEventsChannel, (message: string) =>
        void this.changeHandler(message)
      );
      this.subscriber = subscriber;
      this.active = true;
    } catch (e: unknown) {
      this.log
        .for(this.initialize)
        .error(`Failed to subscribe to Redis change events: ${e}`);
    }
  }

  /**
   * @description Closes the dispatcher and releases the pub/sub subscription
   * @param {...ContextualArgs} args - Contextual arguments
   * @return {Promise<void>} A promise that resolves once the dispatcher is closed
   */
  override async close(
    ...args: ContextualArgs<RedisContext>
  ): Promise<void> {
    this.active = false;
    const subscriber = this.subscriber;
    this.subscriber = undefined;
    if (subscriber) {
      try {
        await subscriber.unsubscribe(RedisEventsChannel);
      } catch (e: unknown) {
        this.log
          .for(this.close)
          .error(`Failed to unsubscribe from Redis change events: ${e}`);
      }
      try {
        await subscriber.quit();
      } catch (e: unknown) {
        this.log
          .for(this.close)
          .error(`Failed to close Redis change subscriber: ${e}`);
      }
    }
    return super.close(...args);
  }

  /**
   * @description Notifies local observers and broadcasts the event to other processes
   * @summary Performs the base local refresh, then publishes the change to the
   * Redis pub/sub channel. Remote processes receive the event and refresh their own
   * observers; the originating process ignores its own message.
   * @param {Constructor<any> | string} model - The model (or table name) that changed
   * @param {OperationKeys | BulkCrudOperationKeys | string} event - The operation that occurred
   * @param {any} id - The identifier(s) of the affected record(s)
   * @param {...ContextualArgs} args - Contextual arguments
   * @return {Promise<void>} A promise that resolves once observers are notified
   */
  override async updateObservers(
    model: any,
    event: OperationKeys | BulkCrudOperationKeys | string,
    id: any,
    ...args: ContextualArgs<RedisContext>
  ): Promise<void> {
    await super.updateObservers(model, event, id, ...args);
    if (!this.adapter) return;
    const table =
      model && typeof model === "string" ? model : Model.tableName(model);
    try {
      await this.adapter.client.publish(
        RedisEventsChannel,
        JSON.stringify({ origin: this.origin, table, event: String(event), id })
      );
    } catch (e: unknown) {
      this.log
        .for(this.updateObservers)
        .error(`Failed to publish Redis change event: ${e}`);
    }
  }

  /**
   * @description Handles an incoming Redis change event
   * @summary Ignores the echo of locally published events and refreshes the
   * observers of this process for events published elsewhere.
   * @param {string} message - The raw JSON pub/sub payload
   * @return {Promise<void>} A promise that resolves once observers are notified
   */
  protected async changeHandler(message: string): Promise<void> {
    try {
      const parsed = JSON.parse(message) as {
        origin: string;
        table: string;
        event: string;
        id: any;
      };
      if (parsed.origin === this.origin) return;
      if (!this.adapter) return;
      const ctx = await this.adapter.context(
        OperationKeys.UPDATE,
        {} as any,
        Model as any
      );
      await super.updateObservers(parsed.table, parsed.event, parsed.id, ctx);
    } catch (e: unknown) {
      this.log
        .for(this.changeHandler)
        .error(`Failed to process Redis change event: ${e}`);
    }
  }
}
