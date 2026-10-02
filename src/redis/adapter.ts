import "reflect-metadata";
import {
  Adapter,
  AdapterFlags,
  ConnectionError,
  ContextLock,
  ContextualArgs,
  MaybeContextualArg,
  PersistenceKeys,
  RawResult,
  Repository,
  Sequence,
} from "@decaf-ts/core";
import { createClient, type RedisClientType } from "redis";
import { QueryError } from "@decaf-ts/core";
import {
  BaseError,
  ConflictError,
  DBKeys,
  generated,
  InternalError,
  NotFoundError,
  onCreate,
  onCreateUpdate,
  OperationKeys,
  PrimaryKeyType,
} from "@decaf-ts/db-decorators";
import { Model } from "@decaf-ts/decorator-validation";
import {
  Constructor,
  Decoration,
  Metadata,
  propMetadata,
} from "@decaf-ts/decoration";
import { RawRedisQuery, RedisConfig, RedisContext, RedisFlags } from "./types";
import { RedisDefaultPrefix, RedisFlavour } from "./constants";
import { RedisStatement } from "./RedisStatement";
import { RedisPaginator } from "./RedisPaginator";
import { RedisDispatch } from "./RedisDispatch";
import { RedisRepository } from "./RedisRepository";
import { RedisContextLock } from "./RedisContextLock";
import { createdByOnRedisCreateUpdate } from "./handlers";
import { deserialize, serialize } from "./serialization";

/**
 * @description Redis adapter for data persistence
 * @summary The RedisAdapter implements the persistence layer on top of Redis
 * (or any Redis-compatible server such as DragonflyDB). Each model table is
 * stored as a single Redis hash whose fields are record ids and whose values are
 * serialized records. The adapter is modelled on the core RAM adapter: raw queries
 * load the matching table, revert every record to a model and then apply the same
 * filtering, sorting, aggregation and pagination logic in JavaScript.
 * `@transactional()` is backed by {@link RedisContextLock}, which buffers writes
 * on a dedicated connection and flushes them atomically with `MULTI`/`EXEC`.
 * @class RedisAdapter
 * @category Redis
 * @example
 * ```typescript
 * const adapter = new RedisAdapter({ url: "redis://localhost:6379" });
 * await adapter.initialize();
 * const repo = new (adapter.repository<User>())(User, adapter);
 * await repo.create(new User({ name: "John" }));
 * ```
 */
export class RedisAdapter extends Adapter<
  RedisConfig,
  RedisClientType,
  RawRedisQuery,
  RedisContext
> {
  private _redisClient?: RedisClientType;

  constructor(conf: RedisConfig = {}, alias?: string) {
    super(conf, RedisFlavour, alias);
  }

  /**
   * @description Gets the repository constructor for a model
   * @summary Returns the Redis repository constructor used to create repositories
   * bound to this adapter.
   * @template R - The repository type
   * @return {Constructor<R>} A constructor for creating Redis repositories
   */
  override repository<
    R extends Repository<any, Adapter<any, any, any, any>>,
  >(): Constructor<R> {
    return RedisRepository as unknown as Constructor<R>;
  }

  /**
   * @description Creates operation flags with a user identity
   * @summary Extends the base flags with a `UUID` used by the `createdBy` and
   * `updatedBy` handlers. Defaults to the configured `user` or the current time.
   * @template M - The model type for the operation
   * @param {OperationKeys} operation - The operation being performed
   * @param {Constructor<M>} model - The model constructor
   * @param {Partial<RedisFlags>} flags - Partial flags to extend
   * @return {Promise<RedisFlags>} The complete flags with a UUID
   */
  override async flags<M extends Model<boolean>>(
    operation: OperationKeys,
    model: Constructor<M>,
    flags: Partial<RedisFlags>
  ): Promise<RedisFlags> {
    return Object.assign(
      await super.flags(
        operation,
        model,
        Object.assign(
          {
            UUID: flags.UUID || this.config.user || "" + Date.now(),
          },
          flags
        )
      )
    ) as RedisFlags;
  }

  /**
   * @description Creates the Redis event dispatcher
   * @return {RedisDispatch} A Redis-aware dispatch instance
   */
  protected override Dispatch(): RedisDispatch {
    return new RedisDispatch();
  }

  /**
   * @description Provides the Redis transaction lock implementation
   * @summary Returns a fresh {@link RedisContextLock} per top-level transaction
   * so `@transactional()` can buffer writes on a dedicated connection.
   * @param {...any[]} args - Optional arguments forwarded to the lock
   * @return {RedisContextLock} A fresh Redis transaction lock
   */
  override transactionLock(...args: any[]): RedisContextLock<this> {
    return new RedisContextLock(this, ...args);
  }

  /**
   * @description Initializes the adapter and opens the Redis connection
   * @param {...MaybeContextualArg} args - Initialization arguments
   * @return {Promise<void>} A promise that resolves once initialization is complete
   */
  override async initialize(
    ...args: MaybeContextualArg<RedisContext>
  ): Promise<void> {
    const { log } = (
      await this.logCtx(args, PersistenceKeys.INITIALIZATION, true)
    ).for(this.initialize);
    const client = this.client;
    try {
      if (!client.isOpen) await client.connect();
    } catch (e: unknown) {
      throw this.parseError(e as Error);
    }
    this._redisClient = client;
    await super.initialize(...args);
    log.verbose(`${this.toString()} initialized`);
  }

  /**
   * @description Shuts down the adapter and closes the Redis connection
   * @param {...MaybeContextualArg} args - Shutdown arguments
   * @return {Promise<void>} A promise that resolves once shutdown is complete
   */
  override async shutdown(
    ...args: MaybeContextualArg<RedisContext>
  ): Promise<void> {
    await super.shutdown(...args);
    const client = this._redisClient ?? this._client;
    this._redisClient = undefined;
    this._client = undefined;
    if (!client) return;
    try {
      await client.quit();
    } catch {
      try {
        client.destroy();
      } catch {
        // the connection is already closed; nothing left to release
      }
    }
  }

  /**
   * @description Builds the namespaced Redis key for a table
   * @param {string} table - The table (model) name
   * @return {string} The namespaced Redis hash key
   */
  recordKey(table: string): string {
    return `${this.config.prefix ?? RedisDefaultPrefix}:${table}`;
  }

  /**
   * @description Resolves the active transaction lock from a context, when present
   * @summary Returns the {@link RedisContextLock} only while a transaction is
   * actually open, so CRUD operations buffer their writes during a transaction and
   * go straight to Redis otherwise.
   * @param {RedisContext} [ctx] - The operation context
   * @return {RedisContextLock | undefined} The active lock, when one exists
   */
  protected activeLock(ctx?: RedisContext): RedisContextLock | undefined {
    const lock = ctx?.getOrUndefined("transactionLock") as
      | ContextLock
      | undefined;
    return lock instanceof RedisContextLock && lock.active ? lock : undefined;
  }

  /**
   * @description Prepares a model for storage
   * @summary Delegates to the base implementation, which extracts the primary
   * key from the record before it is handed to {@link create}.
   * @template M - The model type being prepared
   * @param {M} model - The model instance to prepare
   * @return Object containing the record, id and transient data
   */
  override prepare<M extends Model>(
    model: M,
    ...args: [...any[], RedisContext]
  ): {
    record: Record<string, any>;
    id: string;
    transient?: Record<string, any>;
  } {
    const ctx = args.pop();
    return super.prepare(model, ...args, ctx);
  }

  /**
   * @description Converts a stored record back to a model instance
   * @summary Delegates to the base implementation, reattaching the primary key
   * extracted from the record's Redis hash field.
   * @template M - The model type to revert to
   * @param {Record<string, any>} obj - The stored record
   * @param {Constructor<M>} clazz - The model constructor
   * @param {PrimaryKeyType} id - The primary key value
   * @return {M} The reconstructed model instance
   */
  override revert<M extends Model>(
    obj: Record<string, any>,
    clazz: Constructor<M>,
    id: PrimaryKeyType,
    transient?: Record<string, any>,
    ...args: [...any[], RedisContext]
  ): M {
    return super.revert(obj, clazz, id, transient, ...args);
  }

  /**
   * @description Creates a new record in Redis
   * @summary Writes the serialized record to the table hash. Inside a
   * transaction the write is buffered (read-your-writes) instead of hitting
   * Redis; otherwise `HSETNX` guarantees the record does not already exist.
   * @template M - The model type
   * @param {Constructor<M>} clazz - The model constructor
   * @param {PrimaryKeyType} id - The unique record identifier
   * @param {Record<string, any>} model - The record to store
   * @return {Promise<Record<string, any>>} The stored record
   */
  async create<M extends Model>(
    clazz: Constructor<M>,
    id: PrimaryKeyType,
    model: Record<string, any>,
    ...args: ContextualArgs<RedisContext>
  ): Promise<Record<string, any>> {
    const { log, ctx } = this.logCtx(args, this.create);
    const table = Model.tableName(clazz);
    log.debug(`creating record in table ${table} with id ${id}`);
    const field = String(id);
    const key = this.recordKey(table);
    const lock = this.activeLock(ctx);
    const serialized = serialize(model);
    if (lock) {
      const buffered = lock.getRecord(table, field);
      const exists =
        buffered.found && buffered.value !== null
          ? true
          : await this.client.hExists(key, field);
      if (exists)
        throw new ConflictError(
          `Record with id ${id} already exists in table ${table}`
        );
      lock.setRecord(table, field, serialized);
      return model;
    }
    const created = await this.client.hSetNX(key, field, serialized);
    if (created === 0)
      throw new ConflictError(
        `Record with id ${id} already exists in table ${table}`
      );
    return model;
  }

  /**
   * @description Reads a record from Redis
   * @summary Reads the record from the table hash. Inside a transaction the
   * buffered value wins (read-your-writes); a buffered delete is treated as a
   * missing record.
   * @template M - The model type
   * @param {Constructor<M>} clazz - The model constructor
   * @param {PrimaryKeyType} id - The unique record identifier
   * @return {Promise<Record<string, any>>} The stored record
   */
  async read<M extends Model>(
    clazz: Constructor<M>,
    id: PrimaryKeyType,
    ...args: ContextualArgs<RedisContext>
  ): Promise<Record<string, any>> {
    const { log, ctx } = this.logCtx(args, this.read);
    const table = Model.tableName(clazz);
    log.debug(`reading record in table ${table} with id ${id}`);
    const field = String(id);
    const lock = this.activeLock(ctx);
    if (lock) {
      const buffered = lock.getRecord(table, field);
      if (buffered.found) {
        if (buffered.value === null)
          throw new NotFoundError(
            `Record with id ${id} not found in table ${table}`
          );
        return deserialize(buffered.value);
      }
    }
    const raw = await this.client.hGet(this.recordKey(table), field);
    if (raw === null || raw === undefined)
      throw new NotFoundError(
        `Record with id ${id} not found in table ${table}`
      );
    return deserialize(raw);
  }

  /**
   * @description Updates an existing record in Redis
   * @summary Inside a transaction the write is buffered; otherwise the record
   * is overwritten in place. A missing record raises a `NotFoundError`.
   * @template M - The model type
   * @param {Constructor<M>} clazz - The model constructor
   * @param {PrimaryKeyType} id - The unique record identifier
   * @param {Record<string, any>} model - The new record data
   * @return {Promise<Record<string, any>>} The updated record
   */
  async update<M extends Model>(
    clazz: Constructor<M>,
    id: PrimaryKeyType,
    model: Record<string, any>,
    ...args: ContextualArgs<RedisContext>
  ): Promise<Record<string, any>> {
    const { log, ctx } = this.logCtx(args, this.update);
    const table = Model.tableName(clazz);
    log.debug(`updating record in table ${table} with id ${id}`);
    const field = String(id);
    const key = this.recordKey(table);
    const lock = this.activeLock(ctx);
    const serialized = serialize(model);
    if (lock) {
      const buffered = lock.getRecord(table, field);
      const deleted = buffered.found && buffered.value === null;
      const exists =
        deleted || buffered.found
          ? !deleted
          : await this.client.hExists(key, field);
      if (!exists)
        throw new NotFoundError(
          `Record with id ${id} not found in table ${table}`
        );
      lock.setRecord(table, field, serialized);
      return model;
    }
    const exists = await this.client.hExists(key, field);
    if (!exists)
      throw new NotFoundError(
        `Record with id ${id} not found in table ${table}`
      );
    await this.client.hSet(key, field, serialized);
    return model;
  }

  /**
   * @description Deletes a record from Redis
   * @summary Inside a transaction the delete is buffered; otherwise the field
   * is removed from the table hash immediately. A missing record raises a
   * `NotFoundError`.
   * @template M - The model type
   * @param {Constructor<M>} clazz - The model constructor
   * @param {PrimaryKeyType} id - The unique record identifier
   * @return {Promise<Record<string, any>>} The deleted record
   */
  async delete<M extends Model>(
    clazz: Constructor<M>,
    id: PrimaryKeyType,
    ...args: ContextualArgs<RedisContext>
  ): Promise<Record<string, any>> {
    const { log, ctx } = this.logCtx(args, this.delete);
    const table = Model.tableName(clazz);
    log.debug(`deleting record from table ${table} with id ${id}`);
    const field = String(id);
    const key = this.recordKey(table);
    const lock = this.activeLock(ctx);
    if (lock) {
      const buffered = lock.getRecord(table, field);
      const raw = buffered.found
        ? buffered.value
        : await this.client.hGet(key, field);
      if (raw === null || raw === undefined)
        throw new NotFoundError(
          `Record with id ${id} not found in table ${table}`
        );
      lock.deleteRecord(table, field);
      return deserialize(raw);
    }
    const raw = await this.client.hGet(key, field);
    if (raw === null || raw === undefined)
      throw new NotFoundError(
        `Record with id ${id} not found in table ${table}`
      );
    await this.client.hDel(key, field);
    return deserialize(raw);
  }

  /**
   * @description Loads every record of a table, applying buffered writes
   * @summary Reads the table hash and merges the transaction buffer on top so a
   * query inside a transaction observes the transaction's own writes.
   * @param {string} table - The table (model) name
   * @param {RedisContext} [ctx] - The operation context
   * @return {Promise<[string, string][]>} The record id/serialized pairs
   */
  protected async loadTable(
    table: string,
    ctx?: RedisContext
  ): Promise<[string, string][]> {
    const raw = await this.client.hGetAll(this.recordKey(table));
    const merged = new Map<string, string>(Object.entries(raw));
    const lock = this.activeLock(ctx);
    if (lock) {
      const buffered = lock.tableEntries(table);
      if (buffered) {
        for (const [id, value] of buffered) {
          if (value === null) merged.delete(id);
          else merged.set(id, value);
        }
      }
    }
    return [...merged.entries()];
  }

  /**
   * @description Executes a raw query against Redis
   * @summary Loads the matching table, reverts every record to a model and
   * applies the in-memory filtering, sorting, aggregation and pagination logic.
   * This mirrors the core RAM adapter, since Redis hashes are not queryable.
   * @template R - The query return type
   * @template D - Whether only documents are returned
   * @param {RawRedisQuery<any>} rawInput - The query specification
   * @param {D} docsOnly - Whether to return only documents (default true)
   * @return {Promise<RawResult<R, D>>} The query result
   */
  async raw<R, D extends boolean>(
    rawInput: RawRedisQuery<any>,
    docsOnly: D = true as D,
    ...args: ContextualArgs<RedisContext>
  ): Promise<RawResult<R, D>> {
    const { log, ctx } = this.logCtx(args, this.raw);
    log.debug(`performing raw query: ${JSON.stringify(rawInput)}`);

    const {
      where,
      sort,
      limit,
      skip,
      from,
      groupBy,
      count: countField,
      countDistinct: countDistinctField,
      min: minField,
      max: maxField,
      sum: sumField,
      avg: avgField,
      distinct: distinctField,
    } = rawInput;
    let { select } = rawInput;
    const table = Model.tableName(from);
    const entries = await this.loadTable(table, ctx);
    const clazz = from;
    const id = Model.pk(from);
    const props = Metadata.get(from, Metadata.key(DBKeys.ID, id as string));

    let result: any[] = entries.map(([pk, r]) =>
      this.revert(
        deserialize(r),
        from,
        Sequence.parseValue(props.type as any, pk as string) as string,
        undefined,
        ctx
      )
    );
    if (sort) result = result.sort(sort);

    result = where ? result.filter(where) : result;

    if ("count" in rawInput) {
      if (!countField) return result.length as unknown as RawResult<R, D>;
      const count = result.filter(
        (r) =>
          r[countField as string] !== undefined &&
          r[countField as string] !== null
      ).length;
      return count as unknown as RawResult<R, D>;
    }

    if (countDistinctField !== undefined) {
      const seen = new Set();
      for (const item of result) {
        const value = item[countDistinctField as string];
        if (value !== undefined && value !== null)
          seen.add(JSON.stringify(value));
      }
      return seen.size as unknown as RawResult<R, D>;
    }

    if (minField !== undefined) {
      this.ensureFieldType(
        clazz,
        minField as string,
        "MIN operation",
        (type) => this.isNumericType(type) || type === "date",
        "numeric or date"
      );
      if (result.length === 0) return null as unknown as RawResult<R, D>;
      const values = result
        .map((r) => r[minField as string])
        .filter((v) => v !== undefined && v !== null);
      if (values.length === 0) return null as unknown as RawResult<R, D>;
      let minValue = values[0];
      for (const v of values) {
        const comparison =
          v instanceof Date
            ? v.getTime()
            : typeof v === "bigint"
              ? Number(v)
              : Number(v);
        const minComparison =
          minValue instanceof Date
            ? minValue.getTime()
            : typeof minValue === "bigint"
              ? Number(minValue)
              : Number(minValue);
        if (comparison < minComparison) minValue = v;
      }
      return minValue as unknown as RawResult<R, D>;
    }

    if (maxField !== undefined) {
      this.ensureFieldType(
        clazz,
        maxField as string,
        "MAX operation",
        (type) => this.isNumericType(type) || type === "date",
        "numeric or date"
      );
      if (result.length === 0) return null as unknown as RawResult<R, D>;
      const values = result
        .map((r) => r[maxField as string])
        .filter((v) => v !== undefined && v !== null);
      if (values.length === 0) return null as unknown as RawResult<R, D>;
      let maxValue = values[0];
      for (const v of values) {
        const comparison =
          v instanceof Date
            ? v.getTime()
            : typeof v === "bigint"
              ? Number(v)
              : Number(v);
        const maxComparison =
          maxValue instanceof Date
            ? maxValue.getTime()
            : typeof maxValue === "bigint"
              ? Number(maxValue)
              : Number(maxValue);
        if (comparison > maxComparison) maxValue = v;
      }
      return maxValue as unknown as RawResult<R, D>;
    }

    if (sumField !== undefined) {
      this.ensureFieldType(
        clazz,
        sumField as string,
        "SUM operation",
        (type) => this.isNumericType(type),
        "numeric"
      );
      if (result.length === 0) return null as unknown as RawResult<R, D>;
      const values = result
        .map((r) => r[sumField as string])
        .filter((v) => v !== undefined && v !== null);
      if (values.length === 0) return null as unknown as RawResult<R, D>;
      const sum = values.reduce(
        (acc, v) =>
          acc + this.toNumericValue(v, sumField as string, "SUM operation"),
        0
      );
      return sum as unknown as RawResult<R, D>;
    }

    if (avgField !== undefined) {
      const fieldType = this.resolveFieldType(clazz, avgField as string);
      const isDateField = fieldType === "date";
      this.ensureFieldType(
        clazz,
        avgField as string,
        "AVG operation",
        (type) => this.isNumericType(type) || type === "date",
        "numeric or date"
      );
      if (result.length === 0) return null as unknown as RawResult<R, D>;
      const values = result
        .map((r) => r[avgField as string])
        .filter((v) => v !== undefined && v !== null);
      if (values.length === 0) return null as unknown as RawResult<R, D>;
      if (isDateField) {
        const timestamps = values.map((v) =>
          v instanceof Date ? v.getTime() : new Date(v).getTime()
        );
        const avgTimestamp =
          timestamps.reduce((acc, t) => acc + t, 0) / timestamps.length;
        return new Date(avgTimestamp) as unknown as RawResult<R, D>;
      }
      const total = values.reduce(
        (acc, v) =>
          acc + this.toNumericValue(v, avgField as string, "AVG operation"),
        0
      );
      return (total / values.length) as unknown as RawResult<R, D>;
    }

    if (distinctField !== undefined) {
      const seen = new Set();
      const distinctResults: any[] = [];
      for (const item of result) {
        const value = item[distinctField as string];
        const key = JSON.stringify(value);
        if (!seen.has(key)) {
          seen.add(key);
          distinctResults.push(value);
        }
      }
      return distinctResults as unknown as RawResult<R, D>;
    }

    let count: number;
    let output: any[] | Record<string, any>;
    if (groupBy && groupBy.length) {
      const grouped = this.groupRecords(result, groupBy as (keyof Model)[]);
      const keys = Object.keys(grouped);
      count = keys.length;
      output = this.applyGroupPagination(grouped, skip, limit);
    } else {
      count = result.length;
      let paged = result;
      if (skip) paged = paged.slice(skip);
      if (limit) paged = paged.slice(0, limit);
      output = paged;
    }

    if (select && !(groupBy && groupBy.length)) {
      select = Array.isArray(select) ? select : [select];
      output = (output as any[]).map((row) =>
        Object.entries(row).reduce((acc: Record<string, any>, [key, val]) => {
          if ((select as string[]).includes(key)) acc[key] = val;
          return acc;
        }, {})
      );
    }

    if (docsOnly) return output as unknown as RawResult<R, D>;
    return { data: output, count } as RawResult<R, D>;
  }

  /**
   * @description Groups records by one or more attributes
   * @summary Recursively nests groups when multiple selectors are provided; the
   * top-level result maps each group key to the matching records (or nested groups).
   * @param {any[]} records - The records to group
   * @param {(keyof Model)[]} selectors - The attributes to group by
   * @return {Record<string, any>} The grouped records keyed by normalized group keys
   */
  private groupRecords(
    records: any[],
    selectors: (keyof Model)[]
  ): Record<string, any> {
    if (!selectors.length) return records as Record<string, any>;
    const [current, ...rest] = selectors;
    const grouped: Record<string, any[]> = {};
    for (const record of records) {
      const key = this.normalizeGroupKey(record[current as string]);
      if (!grouped[key]) grouped[key] = [];
      grouped[key].push(record);
    }
    if (!rest.length) return grouped;
    const nested: Record<string, any> = {};
    for (const [key, values] of Object.entries(grouped)) {
      nested[key] = this.groupRecords(values, rest);
    }
    return nested;
  }

  /**
   * @description Normalizes a group key to a string
   * @summary Produces a stable string key for `undefined`, `null`, symbols,
   * objects (via JSON) and primitives.
   * @param {any} value - The raw group key value
   * @return {string} The normalized key
   */
  private normalizeGroupKey(value: any): string {
    if (value === undefined) return "undefined";
    if (value === null) return "null";
    if (typeof value === "symbol") return value.toString();
    if (typeof value === "object") {
      try {
        return JSON.stringify(value);
      } catch {
        return String(value);
      }
    }
    return String(value);
  }

  /**
   * @description Applies skip/limit pagination over grouped results
   * @summary Pages the group keys while preserving their associated records.
   * @param {Record<string, any>} grouped - The grouped records
   * @param {number} [skip] - The number of groups to skip
   * @param {number} [limit] - The maximum number of groups to return
   * @return {Record<string, any>} The paged groups
   */
  private applyGroupPagination(
    grouped: Record<string, any>,
    skip?: number,
    limit?: number
  ): Record<string, any> {
    if (typeof skip === "undefined" && typeof limit === "undefined")
      return grouped;
    const keys = Object.keys(grouped);
    const start = skip ?? 0;
    const end = typeof limit === "undefined" ? undefined : start + limit;
    const paged: Record<string, any> = {};
    for (const key of keys.slice(start, end)) {
      paged[key] = grouped[key];
    }
    return paged;
  }

  /**
   * @description Parses and converts errors to appropriate types
   * @summary Returns `BaseError` instances unchanged, maps connection
   * failures to `ConnectionError` and wraps everything else in an
   * `InternalError`.
   * @template V - The expected error type
   * @param {Error} err - The error to parse
   * @return {V} The parsed error
   */
  parseError<V extends BaseError>(err: Error): V {
    if (err instanceof BaseError) return err as V;
    const message = (err as any)?.message ?? String(err);
    if (
      /ECONNREFUSED|ENOTFOUND|ETIMEDOUT|Connection is closed|Socket closed|WRONGPASS|NOAUTH/i.test(
        message
      )
    )
      return new ConnectionError(err) as V;
    return new InternalError(err) as V;
  }

  /**
   * @description Creates a new statement builder for queries
   * @template M - The model type for the statement
   * @param {Partial<AdapterFlags>} [overrides] - Optional adapter flag overrides
   * @return {RedisStatement<M, any, Adapter<...>>} A new statement builder
   */
  Statement<M extends Model<boolean>>(
    overrides?: Partial<AdapterFlags>
  ): RedisStatement<M, any, Adapter<any, any, RawRedisQuery<M>, RedisContext>> {
    return new RedisStatement<
      M,
      any,
      Adapter<any, any, RawRedisQuery<M>, RedisContext>
    >(this as any, overrides);
  }

  /**
   * @description Creates a new paginator for queries
   * @template M - The model type for the paginator
   * @param {RawRedisQuery} query - The query to paginate
   * @param {number} size - The page size
   * @param {Constructor<M>} clazz - The model constructor
   * @return {RedisPaginator<M>} A new paginator
   */
  Paginator<M extends Model<boolean>>(
    query: RawRedisQuery,
    size: number,
    clazz: Constructor<M>
  ): RedisPaginator<M> {
    return new RedisPaginator(this, query, size, clazz);
  }

  /**
   * @description Validates that an aggregation targets an attribute of the expected kind
   * @summary Resolves the attribute type from the model metadata and raises a
   * `QueryError` when the type does not satisfy the given predicate.
   * @param {Constructor<Model>} clazz - The model constructor
   * @param {string} field - The attribute name to validate
   * @param {string} context - The aggregation context used in error messages
   * @param {function(string): boolean} predicate - Type acceptance predicate
   * @param {string} description - Human readable description of the accepted types
   * @return {void}
   */
  private ensureFieldType(
    clazz: Constructor<Model>,
    field: string,
    context: string,
    predicate: (type: string) => boolean,
    description: string
  ): void {
    const type = this.resolveFieldType(clazz, field);
    if (!type || !predicate(type)) {
      throw new QueryError(
        `${context} requires ${description} attribute, but "${field}" is ${
          type || "unknown"
        }`
      );
    }
  }

  /**
   * @description Resolves the attribute type from the model metadata
   * @summary Reads the metadata or design type of the attribute and normalizes it
   * to a lowercase type name.
   * @param {Constructor<Model>} clazz - The model constructor
   * @param {string} field - The attribute name
   * @return {string | undefined} The normalized attribute type, when resolvable
   */
  private resolveFieldType(
    clazz: Constructor<Model>,
    field: string
  ): string | undefined {
    const propKey = field as keyof Model<false>;
    const metaType =
      Metadata.type(clazz, propKey) ??
      Metadata.getPropDesignTypes(clazz, propKey)?.designType;
    return this.normalizeMetaType(metaType);
  }

  /**
   * @description Normalizes a raw metadata type to a lowercase type name
   * @param {any} metaType - The raw metadata type value
   * @return {string | undefined} The normalized type name, when resolvable
   */
  private normalizeMetaType(metaType: any): string | undefined {
    if (!metaType) return undefined;
    if (typeof metaType === "string") return metaType.toLowerCase();
    if (typeof metaType === "function" && metaType.name)
      return metaType.name.toLowerCase();
    return undefined;
  }

  /**
   * @description Whether the given type name is a numeric type
   * @param {string} [type] - The normalized type name
   * @return {boolean} True for "number" and "bigint"
   */
  private isNumericType(type?: string): boolean {
    return type === "number" || type === "bigint";
  }

  /**
   * @description Converts a value to a numeric value for aggregation
   * @summary Accepts numbers and bigints (converted to `Number`) and raises a
   * `QueryError` for any other value kind.
   * @param {any} value - The value to convert
   * @param {string} field - The attribute name used in error messages
   * @param {string} context - The aggregation context used in error messages
   * @return {number} The numeric value
   */
  private toNumericValue(value: any, field: string, context: string): number {
    if (typeof value === "number") return value;
    if (typeof value === "bigint") return Number(value);
    throw new QueryError(
      `${context} on "${field}" requires numeric values, but got ${typeof value}`
    );
  }

  /**
   * @description Creates the underlying Redis client
   * @summary Returns the already connected client when one exists (including
   * through a `for()` configuration-scoped proxy, whose own `_client` slot would
   * otherwise be empty and build a fresh unconnected client). Otherwise builds a
   * node-redis client from the configured URL or discrete host/port/credentials.
   * The client is created lazily and connected by {@link initialize}.
   * @return {RedisClientType} The Redis client
   */
  protected getClient(): RedisClientType {
    if (this._redisClient) return this._redisClient;
    const { url, host, port, username, password, database } = this.config;
    const options: Record<string, any> = url
      ? { url }
      : { socket: { host: host ?? "localhost", port: port ?? 6379 } };
    if (username) options.username = username;
    if (password) options.password = password;
    if (typeof database === "number") options.database = database;
    return createClient(options) as unknown as RedisClientType;
  }

  /**
   * @description Registers Redis-specific decorations for model properties
   * @summary Configures `createdBy` and `updatedBy` handlers for the Redis
   * flavour so those fields are populated from the context UUID.
   * @return {void}
   */
  static override decoration(): void {
    super.decoration();
    const createdByKey = PersistenceKeys.CREATED_BY;
    const updatedByKey = PersistenceKeys.UPDATED_BY;
    Decoration.flavouredAs(RedisFlavour)
      .for(createdByKey)
      .define(
        onCreate(createdByOnRedisCreateUpdate),
        propMetadata(createdByKey, {}),
        generated(createdByKey)
      )
      .apply();
    Decoration.flavouredAs(RedisFlavour)
      .for(updatedByKey)
      .define(
        onCreateUpdate(createdByOnRedisCreateUpdate),
        propMetadata(updatedByKey, {}),
        generated(updatedByKey)
      )
      .apply();
  }
}

Adapter.setCurrent(RedisFlavour);
RedisAdapter.decoration();
