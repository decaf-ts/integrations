import { Context, ContextLock } from "@decaf-ts/core";
import { ConflictError } from "@decaf-ts/db-decorators";
import { WatchError, type RedisClientType } from "redis";
import type { RedisAdapter } from "./adapter";

/**
 * @description A pending write buffered for the duration of a transaction
 * @summary `null` represents a pending delete; a string represents the serialized
 * record to be written.
 * @typedef {string | null} RedisBufferedValue
 * @memberOf module:redis
 */
export type RedisBufferedValue = string | null;

/**
 * @description Redis-native transaction lock for the Redis adapter
 * @summary Backs `@transactional()` with a dedicated Redis connection carrying a
 * native `MULTI` command queue plus an in-memory read cache. Every CRUD write
 * performed under an active transaction is queued on the native `MULTI` object and
 * mirrored into the read cache, so the transaction observes its own writes
 * (read-your-writes) while remaining invisible to every other connection until
 * {@link RedisContextLock.commit} issues `WATCH` and `EXEC`. If a watched table
 * changed concurrently, `EXEC` aborts and the transaction raises a
 * `ConflictError` instead of silently overwriting the concurrent write.
 *
 * A dedicated connection is required: `WATCH` is per-connection state on the
 * node-redis client, so a `WATCH` issued on the shared, multiplexed adapter
 * client would be cleared or replaced by any concurrent adapter operation (and a
 * concurrent write to a watched key would abort an unrelated transaction).
 * @class RedisContextLock
 * @category Redis
 */
export class RedisContextLock<
  A extends RedisAdapter = RedisAdapter,
> extends ContextLock<A> {
  private txClient?: RedisClientType;
  private multi?: ReturnType<RedisClientType["multi"]>;
  private readCache = new Map<string, Map<string, RedisBufferedValue>>();

  /**
   * @description Whether a Redis transaction is currently open
   * @return {boolean} True while a transaction is active
   */
  get active(): boolean {
    return !!this.txClient;
  }

  /**
   * @description Returns the buffered entry for a record, when present
   * @param {string} table - The table (model) name
   * @param {string} id - The record id
   * @return {{found: boolean, value?: RedisBufferedValue}} The buffered entry state
   */
  getRecord(
    table: string,
    id: string
  ): { found: true; value: RedisBufferedValue } | { found: false } {
    const entries = this.readCache.get(table);
    if (!entries || !entries.has(id)) return { found: false };
    return { found: true, value: entries.get(id) as RedisBufferedValue };
  }

  /**
   * @description Queues a serialized record on the native transaction and buffers it for reads
   * @param {string} table - The table (model) name
   * @param {string} id - The record id
   * @param {string} value - The serialized record
   * @return {void}
   */
  setRecord(table: string, id: string, value: RedisBufferedValue): void {
    let entries = this.readCache.get(table);
    if (!entries) {
      entries = new Map();
      this.readCache.set(table, entries);
    }
    entries.set(id, value);
    if (!this.multi) return;
    const key = this.adapter.recordKey(table);
    if (value === null) this.multi.hDel(key, id);
    else this.multi.hSet(key, id, value);
  }

  /**
   * @description Queues a record deletion on the native transaction and buffers it
   * @param {string} table - The table (model) name
   * @param {string} id - The record id
   * @return {void}
   */
  deleteRecord(table: string, id: string): void {
    this.setRecord(table, id, null);
  }

  /**
   * @description Returns the buffered writes for a table, when any exist
   * @param {string} table - The table (model) name
   * @return {Map<string, RedisBufferedValue> | undefined} The buffered entries
   */
  tableEntries(
    table: string
  ): Map<string, RedisBufferedValue> | undefined {
    return this.readCache.get(table);
  }

  /**
   * @description Starts the transaction, opening a dedicated connection and native queue
   * @summary Delegates to the base implementation so `maxConcurrentTransactions`
   * continues to gate concurrency, then opens a dedicated connection and its native
   * `MULTI` command queue.
   * @param {Context<any>} context - The context the transaction is starting under
   * @return {Promise<void>} A promise that resolves once the transaction is open
   */
  override async begin(context: Context<any>): Promise<void> {
    await super.begin(context);
    try {
      const client = this.adapter.client.duplicate();
      await client.connect();
      this.txClient = client as unknown as RedisClientType;
      this.multi = this.txClient.multi();
    } catch (e: unknown) {
      await super.rollback(e as Error, context);
      throw e;
    }
  }

  /**
   * @description Flushes the queued writes atomically and ends the transaction
   * @summary `WATCH`es every touched table on the dedicated connection, then runs
   * the native `MULTI` queue with `EXEC`. If a watched table changed concurrently,
   * `EXEC` aborts with a `WatchError` and the transaction raises a
   * `ConflictError`. On success (or conflict) the dedicated connection is released
   * and the concurrency permit returned.
   * @param {Context<any>} context - The context the transaction ran under
   * @return {Promise<void>} A promise that resolves once the transaction ends
   */
  override async commit(context: Context<any>): Promise<void> {
    if (!this.txClient || !this.multi) {
      await super.commit(context);
      return;
    }
    const watched = [...this.readCache.keys()].map((table) =>
      this.adapter.recordKey(table)
    );
    try {
      if (watched.length) await this.txClient.watch(watched);
      await this.multi.exec();
    } catch (e: unknown) {
      if (e instanceof WatchError)
        throw new ConflictError(
          "Redis transaction aborted: a watched record changed concurrently"
        );
      throw e;
    } finally {
      await this.releaseTx();
      await super.commit(context);
    }
  }

  /**
   * @description Discards the queued writes and ends the transaction
   * @param {Error} err - The error that triggered the rollback
   * @param {Context<any>} context - The context the transaction ran under
   * @return {Promise<void>} A promise that resolves once the transaction ends
   */
  override async rollback(
    err: Error,
    context: Context<any>
  ): Promise<void> {
    await this.releaseTx();
    await super.rollback(err, context);
  }

  /**
   * @description Releases the dedicated transaction connection and clears state
   * @summary Unwatches and closes the dedicated connection, then clears the native
   * queue and read cache so queued writes are never applied after rollback or after
   * an already flushed commit.
   * @return {Promise<void>} A promise that resolves once the connection is released
   */
  private async releaseTx(): Promise<void> {
    const client = this.txClient;
    this.txClient = undefined;
    this.multi = undefined;
    this.readCache.clear();
    if (!client) return;
    try {
      await client.unwatch();
    } catch {
      // the connection may already be gone; nothing left to unwatch
    }
    try {
      await client.quit();
    } catch {
      try {
        client.destroy();
      } catch {
        // connection already closed
      }
    }
  }
}
