import { Context, ContextLock } from "@decaf-ts/core";
import { ConflictError, InternalError } from "@decaf-ts/db-decorators";
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
 * @summary Backs `@transactional()` with a dedicated duplicated Redis connection
 * and an in-memory write buffer. Every CRUD operation performed under an active
 * transaction is buffered instead of being written to the shared connection, so the
 * transaction observes its own writes (read-your-writes) while remaining invisible
 * to every other connection until {@link RedisContextLock.commit} flushes the buffer.
 * `commit` uses `WATCH`/`MULTI`/`EXEC` optimistic locking: if a watched record
 * changed between the start of the commit and `EXEC`, the transaction raises a
 * `ConflictError` instead of silently overwriting the concurrent write.
 * @class RedisContextLock
 * @category Redis
 */
export class RedisContextLock<
  A extends RedisAdapter = RedisAdapter,
> extends ContextLock<A> {
  private txClient?: RedisClientType;
  private buffer = new Map<string, Map<string, RedisBufferedValue>>();

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
    const entries = this.buffer.get(table);
    if (!entries || !entries.has(id)) return { found: false };
    return { found: true, value: entries.get(id) as RedisBufferedValue };
  }

  /**
   * @description Whether a record has a buffered write (including a delete)
   * @param {string} table - The table (model) name
   * @param {string} id - The record id
   * @return {boolean} True when a buffered write exists
   */
  hasRecord(table: string, id: string): boolean {
    return this.buffer.get(table)?.has(id) ?? false;
  }

  /**
   * @description Buffers a serialized record to be written on commit
   * @param {string} table - The table (model) name
   * @param {string} id - The record id
   * @param {string} value - The serialized record
   * @return {void}
   */
  setRecord(table: string, id: string, value: RedisBufferedValue): void {
    let entries = this.buffer.get(table);
    if (!entries) {
      entries = new Map();
      this.buffer.set(table, entries);
    }
    entries.set(id, value);
  }

  /**
   * @description Buffers a record deletion to be applied on commit
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
    return this.buffer.get(table);
  }

  /**
   * @description Starts the transaction, creating a dedicated Redis connection
   * @summary Delegates to the base implementation so `maxConcurrentTransactions`
   * continues to gate concurrency, then opens a duplicated connection used only for
   * `WATCH`/`MULTI`/`EXEC`.
   * @param {Context<any>} context - The context the transaction is starting under
   * @return {Promise<void>} A promise that resolves once the transaction is open
   */
  override async begin(context: Context<any>): Promise<void> {
    await super.begin(context);
    try {
      const client = this.adapter.client.duplicate();
      await client.connect();
      this.txClient = client as unknown as RedisClientType;
    } catch (e: unknown) {
      await super.rollback(e as Error, context);
      throw e;
    }
  }

  /**
   * @description Flushes the buffered writes atomically and ends the transaction
   * @summary Applies every buffered write with `MULTI`/`EXEC`. The touched table
   * keys are `WATCH`ed first so a concurrent change causes `EXEC` to abort and a
   * `ConflictError` to be raised rather than a lost update. On success (or conflict)
   * the dedicated connection is released and the concurrency permit returned.
   * @param {Context<any>} context - The context the transaction ran under
   * @return {Promise<void>} A promise that resolves once the transaction ends
   */
  override async commit(context: Context<any>): Promise<void> {
    if (!this.txClient) {
      await super.commit(context);
      return;
    }
    const client = this.txClient;
    const watched = [...this.buffer.keys()].map((table) =>
      this.adapter.recordKey(table)
    );
    try {
      if (watched.length) await client.watch(watched);
      const multi = client.multi();
      for (const [table, entries] of this.buffer) {
        const key = this.adapter.recordKey(table);
        for (const [id, value] of entries) {
          if (value === null) multi.hDel(key, id);
          else multi.hSet(key, id, value);
        }
      }
      let result: unknown;
      try {
        result = await multi.exec();
      } catch (e: unknown) {
        if (e instanceof WatchError)
          throw new ConflictError(
            "Redis transaction aborted: a watched record changed concurrently"
          );
        throw e;
      }
      if (result === null)
        throw new ConflictError(
          "Redis transaction aborted: a watched record changed concurrently"
        );
    } finally {
      await this.releaseTx();
      await super.commit(context);
    }
  }

  /**
   * @description Discards the buffered writes and ends the transaction
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
   * @description Releases the dedicated transaction connection and clears the buffer
   * @summary Unwatches and closes the duplicated connection, then clears the
   * in-memory write buffer so buffered writes are never applied after rollback
   * or after an already flushed commit.
   * @return {Promise<void>} A promise that resolves once the connection is released
   */
  private async releaseTx(): Promise<void> {
    const client = this.txClient;
    this.txClient = undefined;
    this.buffer.clear();
    if (!client) return;
    try {
      await client.unwatch();
    } catch {
      // the connection may already be gone; nothing left to unwatch
    }
    try {
      await client.quit();
    } catch (e: unknown) {
      if (e instanceof InternalError) throw e;
      try {
        await client.disconnect();
      } catch {
        // connection already closed
      }
    }
  }
}
