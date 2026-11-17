import "reflect-metadata";
import {
  Adapter,
  AdapterFlags,
  ContextualArgs,
  MaybeContextualArg,
  PersistenceKeys,
  QueryError,
  RawResult,
  Repository,
  Sequence,
  type SequenceOptions,
} from "@decaf-ts/core";
import {
  BaseError,
  generated,
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
import { ERPNextClient } from "./client";
import { ERPNextFlavour, ERPNextNoLimit } from "./constants";
import { ERPNextContextLock } from "./ERPNextContextLock";
import { ERPNextDispatch } from "./ERPNextDispatch";
import { ERPNextPaginator } from "./ERPNextPaginator";
import { ERPNextRepository } from "./ERPNextRepository";
import { ERPNextStatement } from "./ERPNextStatement";
import {
  ERPNextError,
  ERPNextConnectionError,
  parseERPNextError,
} from "./errors";
import { createdByOnERPNextCreateUpdate } from "./handlers";
import { reviveERPNextRecord, serializeERPNextRecord } from "./serialization";
import type {
  ERPNextConfig,
  ERPNextContext,
  ERPNextFlags,
  RawERPNextQuery,
} from "./types";

/**
 * @description ERPNext persistence adapter
 * @summary Implements the decaf persistence contract on top of the Frappe REST
 * resource API. Each decaf model maps to an ERPNext doctype (its `@table` name),
 * and CRUD is delegated to `ERPNextClient`, which handles token authentication,
 * the session-login fallback and error normalization.
 *
 * Queries use the Frappe list API where a condition can be expressed as a filter
 * and always apply the core predicate in memory, so complex conditions stay
 * correct. Aggregations are evaluated in memory for the same reason. The adapter
 * has no native transaction support (see {@link ERPNextContextLock}).
 * @class ERPNextAdapter
 * @category ERPNext
 * @example
 * ```typescript
 * const adapter = new ERPNextAdapter({
 *   baseUrl: "https://erp.example.com",
 *   apiKey: process.env.ERPNEXT_API_KEY,
 *   apiSecret: process.env.ERPNEXT_API_SECRET,
 * });
 * await adapter.initialize();
 * const customers = Repository.forModel(ERPNextCustomer);
 * await customers.create(new ERPNextCustomer({ customer_name: "ACME" }));
 * ```
 */
export class ERPNextAdapter extends Adapter<
  ERPNextConfig,
  ERPNextClient,
  RawERPNextQuery,
  ERPNextContext
> {
  private _erpClient?: ERPNextClient;

  /**
   * @description Creates an ERPNext adapter
   * @param {ERPNextConfig} conf - The site and authentication configuration
   * @param {string} [alias] - Optional adapter alias
   */
  constructor(conf: ERPNextConfig = {} as ERPNextConfig, alias?: string) {
    super(conf, ERPNextFlavour, alias);
  }

  /**
   * @description Creates operation flags with a user identity
   * @summary Extends the base flags with a `UUID` used by the `createdBy` and
   * `updatedBy` handlers, defaulting to the configured username or the current time.
   * @template M - The model type
   * @param {OperationKeys} operation - The operation being performed
   * @param {Constructor<M>} model - The model constructor
   * @param {Partial<ERPNextFlags>} flags - Partial flags to extend
   * @return {Promise<ERPNextFlags>} The complete flags with a UUID
   */
  override async flags<M extends Model<boolean>>(
    operation: OperationKeys,
    model: Constructor<M>,
    flags: Partial<ERPNextFlags>
  ): Promise<ERPNextFlags> {
    return Object.assign(
      await super.flags(
        operation,
        model,
        Object.assign(
          {
            UUID: flags.UUID || this.config.username || "" + Date.now(),
          },
          flags
        )
      )
    ) as ERPNextFlags;
  }

  /**
   * @description Creates the ERPNext event dispatcher
   * @return {ERPNextDispatch} A local ERPNext-aware dispatcher
   */
  protected override Dispatch(): ERPNextDispatch {
    return new ERPNextDispatch();
  }

  /**
   * @description Provides the ERPNext transaction lock implementation
   * @summary Returns a lock that only gates concurrency; ERPNext has no
   * client-visible transaction boundary.
   * @param {...any[]} args - Optional arguments forwarded to the lock
   * @return {ERPNextContextLock} A fresh lock
   */
  override transactionLock(...args: any[]): ERPNextContextLock<this> {
    return new ERPNextContextLock(this, ...args);
  }

  /**
   * @description Returns the standard-API repository for this adapter
   * @template R - The repository subtype
   * @return {Constructor<R>} The {@link ERPNextRepository} constructor
   */
  override repository<
    R extends Repository<
      any,
      Adapter<ERPNextConfig, ERPNextClient, RawERPNextQuery, ERPNextContext>
    >,
  >(): Constructor<R> {
    return ERPNextRepository as unknown as Constructor<R>;
  }

  /**
   * @description Initializes the adapter and authenticates the client
   * @param {...MaybeContextualArg} args - Initialization arguments
   * @return {Promise<void>} A promise that resolves once initialization is complete
   */
  override async initialize(
    ...args: MaybeContextualArg<ERPNextContext>
  ): Promise<void> {
    const { log } = (
      await this.logCtx(args, PersistenceKeys.INITIALIZATION, true)
    ).for(this.initialize);
    await this.client.initialize();
    await super.initialize(...args);
    log.verbose(`${this.toString()} initialized`);
  }

  /**
   * @description Shuts the adapter down
   * @summary The REST client holds no socket of its own; the base shutdown still
   * releases proxies and the event dispatcher.
   * @param {...MaybeContextualArg} args - Shutdown arguments
   * @return {Promise<void>} A promise that resolves once shutdown is complete
   */
  override async shutdown(
    ...args: MaybeContextualArg<ERPNextContext>
  ): Promise<void> {
    await super.shutdown(...args);
    this._erpClient = undefined;
    this._client = undefined;
  }

  /**
   * @description Creates a document
   * @summary Serializes the prepared record for ERPNext and posts it to
   * `/api/resource/{doctype}`. The server-assigned `name` is returned in the
   * response and reattached by {@link revert}.
   * @template M - The model type
   * @param {Constructor<M>} clazz - The model constructor (its table is the doctype)
   * @param {PrimaryKeyType} id - The document name, when the caller supplied one
   * @param {Record<string, any>} model - The prepared record
   * @return {Promise<Record<string, any>>} The created document
   */
  async create<M extends Model>(
    clazz: Constructor<M>,
    id: PrimaryKeyType,
    model: Record<string, any>,
    ...args: ContextualArgs<ERPNextContext>
  ): Promise<Record<string, any>> {
    const { log } = this.logCtx(args, this.create);
    const doctype = Model.tableName(clazz);
    log.debug(`creating ${doctype} document ${id ?? "(server named)"}`);
    const record = serializeERPNextRecord(model);
    const created = await this.client.createDoc(doctype, record);
    return Object.assign({}, record, created ?? {});
  }

  /**
   * @description Reads a document by name
   * @template M - The model type
   * @param {Constructor<M>} clazz - The model constructor
   * @param {PrimaryKeyType} id - The document name
   * @return {Promise<Record<string, any>>} The document
   */
  async read<M extends Model>(
    clazz: Constructor<M>,
    id: PrimaryKeyType,
    ...args: ContextualArgs<ERPNextContext>
  ): Promise<Record<string, any>> {
    const { log } = this.logCtx(args, this.read);
    const doctype = Model.tableName(clazz);
    log.debug(`reading ${doctype} document ${id}`);
    return this.client.getDoc(doctype, String(id));
  }

  /**
   * @description Updates a document
   * @template M - The model type
   * @param {Constructor<M>} clazz - The model constructor
   * @param {PrimaryKeyType} id - The document name
   * @param {Record<string, any>} model - The changed fields
   * @return {Promise<Record<string, any>>} The updated document
   */
  async update<M extends Model>(
    clazz: Constructor<M>,
    id: PrimaryKeyType,
    model: Record<string, any>,
    ...args: ContextualArgs<ERPNextContext>
  ): Promise<Record<string, any>> {
    const { log } = this.logCtx(args, this.update);
    const doctype = Model.tableName(clazz);
    log.debug(`updating ${doctype} document ${id}`);
    const record = serializeERPNextRecord(model);
    const updated = await this.client.updateDoc(
      doctype,
      String(id),
      record
    );
    return Object.assign({}, record, updated ?? {});
  }

  /**
   * @description Deletes a document
   * @template M - The model type
   * @param {Constructor<M>} clazz - The model constructor
   * @param {PrimaryKeyType} id - The document name
   * @return {Promise<Record<string, any>>} The deleted document payload
   */
  async delete<M extends Model>(
    clazz: Constructor<M>,
    id: PrimaryKeyType,
    ...args: ContextualArgs<ERPNextContext>
  ): Promise<Record<string, any>> {
    const { log } = this.logCtx(args, this.delete);
    const doctype = Model.tableName(clazz);
    log.debug(`deleting ${doctype} document ${id}`);
    const deleted = await this.client.deleteDoc(doctype, String(id));
    return Object.assign({ name: String(id) }, deleted ?? {});
  }

  /**
   * @description Reverts an ERPNext document into a model instance
   * @summary Revives ERPNext date/datetime strings into `Date` instances, then
   * delegates to the base contract. The document name is taken from the record when
   * present so server-assigned names survive a create.
   * @template M - The model type
   * @param {Record<string, any>} obj - The ERPNext document
   * @param {Constructor<M>} clazz - The model constructor
   * @param {PrimaryKeyType} id - The expected primary key
   * @param {Record<string, any>} [transient] - Transient attributes
   * @return {M} The reconstructed model
   */
  override revert<M extends Model>(
    obj: Record<string, any>,
    clazz: Constructor<M>,
    id: PrimaryKeyType,
    transient?: Record<string, any>,
    ...args: ContextualArgs<ERPNextContext>
  ): M {
    const revived = reviveERPNextRecord(obj ?? {}, clazz);
    const pk = Model.pk(clazz);
    const pkColumn = Model.columnName(clazz, pk);
    const resolved = (revived[pkColumn] ?? revived[pk as string] ?? id) as PrimaryKeyType;
    return super.revert(revived, clazz, resolved, transient, ...args);
  }

  /**
   * @description Executes a raw ERPNext query
   * @summary Reads the matching documents through the Frappe list API, reverts
   * them to models, applies the in-memory predicate and evaluates the requested
   * aggregation, grouping and pagination — mirroring the core RAM/Redis contract
   * because Frappe cannot express the full query vocabulary server-side.
   * @template R - The result type
   * @template D - Whether only documents are returned
   * @param {RawERPNextQuery<any>} rawInput - The query specification
   * @param {D} docsOnly - Whether to return only documents (default true)
   * @return {Promise<RawResult<R, D>>} The query result
   */
  async raw<R, D extends boolean>(
    rawInput: RawERPNextQuery<any>,
    docsOnly: D = true as D,
    ...args: ContextualArgs<ERPNextContext>
  ): Promise<RawResult<R, D>> {
    const { log, ctx } = this.logCtx(args, this.raw);
    log.debug(`performing raw query: ${JSON.stringify(rawInput)}`);

    const {
      where,
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
    const doctype = Model.tableName(from);
    const pk = Model.pk(from);
    const selectedFields = select
      ? (Array.isArray(select) ? select : [select]).map(String)
      : undefined;
    const hasRepresentableFilters =
      Array.isArray(rawInput.filters) && rawInput.filters.length > 0;
    let fields: string[];
    if (!selectedFields || !hasRepresentableFilters) {
      fields = ["*"];
    } else {
      const required = new Set<string>([...selectedFields, String(pk)]);
      for (const filter of rawInput.filters ?? [])
        required.add(String(filter[0]));
      for (const clause of rawInput.orderBy ?? [])
        required.add(String(clause.field));
      for (const key of groupBy ?? []) required.add(String(key));
      for (const aggregate of [
        countField,
        countDistinctField,
        minField,
        maxField,
        sumField,
        avgField,
        distinctField,
      ])
        if (aggregate !== undefined && aggregate !== null)
          required.add(String(aggregate));
      fields = [...required];
    }
    const documents = await this.client.listDocs(doctype, {
      filters: rawInput.filters,
      fields,
      orderBy: rawInput.orderBy,
      limitPageLength: ERPNextNoLimit,
    });

    let result: any[] = documents.map((document) => {
      const documentId =
        document[Model.columnName(from, pk)] ?? document[pk as string];
      return this.revert(
        document,
        from,
        documentId as PrimaryKeyType,
        undefined,
        ctx
      );
    });

    result = where ? result.filter(where) : result;

    if ("count" in rawInput) {
      if (!countField) return result.length as unknown as RawResult<R, D>;
      const count = result.filter(
        (record) =>
          record[countField as string] !== undefined &&
          record[countField as string] !== null
      ).length;
      return count as unknown as RawResult<R, D>;
    }

    if (countDistinctField !== undefined) {
      const seen = new Set<string>();
      for (const item of result) {
        const value = item[countDistinctField as string];
        if (value !== undefined && value !== null)
          seen.add(JSON.stringify(value));
      }
      return seen.size as unknown as RawResult<R, D>;
    }

    if (minField !== undefined) {
      this.ensureFieldType(
        from,
        minField as string,
        "MIN operation",
        (type) => this.isNumericType(type) || type === "date",
        "numeric or date"
      );
      const values = this.numericValues(result, minField as string);
      if (!values.length) return null as unknown as RawResult<R, D>;
      return values.reduce((min, value) =>
        this.compareAggregate(value, min) < 0 ? value : min
      ) as unknown as RawResult<R, D>;
    }

    if (maxField !== undefined) {
      this.ensureFieldType(
        from,
        maxField as string,
        "MAX operation",
        (type) => this.isNumericType(type) || type === "date",
        "numeric or date"
      );
      const values = this.numericValues(result, maxField as string);
      if (!values.length) return null as unknown as RawResult<R, D>;
      return values.reduce((max, value) =>
        this.compareAggregate(value, max) > 0 ? value : max
      ) as unknown as RawResult<R, D>;
    }

    if (sumField !== undefined) {
      this.ensureFieldType(
        from,
        sumField as string,
        "SUM operation",
        (type) => this.isNumericType(type),
        "numeric"
      );
      const values = this.numericValues(result, sumField as string);
      if (!values.length) return null as unknown as RawResult<R, D>;
      return values.reduce(
        (sum, value) =>
          sum + this.toNumericValue(value, sumField as string, "SUM operation"),
        0
      ) as unknown as RawResult<R, D>;
    }

    if (avgField !== undefined) {
      const fieldType = this.resolveFieldType(from, avgField as string);
      const isDateField = fieldType === "date";
      this.ensureFieldType(
        from,
        avgField as string,
        "AVG operation",
        (type) => this.isNumericType(type) || type === "date",
        "numeric or date"
      );
      const values = this.numericValues(result, avgField as string);
      if (!values.length) return null as unknown as RawResult<R, D>;
      if (isDateField) {
        const timestamps = values.map((value) =>
          value instanceof Date ? value.getTime() : new Date(value).getTime()
        );
        return new Date(
          timestamps.reduce((sum, value) => sum + value, 0) / timestamps.length
        ) as unknown as RawResult<R, D>;
      }
      const total = values.reduce(
        (sum, value) =>
          sum + this.toNumericValue(value, avgField as string, "AVG operation"),
        0
      );
      return (total / values.length) as unknown as RawResult<R, D>;
    }

    if (distinctField !== undefined) {
      const seen = new Set<string>();
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
      output = this.applyGroupPagination(grouped, rawInput.skip, rawInput.limit);
    } else {
      count = result.length;
      let paged = result;
      if (rawInput.skip) paged = paged.slice(rawInput.skip);
      if (rawInput.limit) paged = paged.slice(0, rawInput.limit);
      output = paged;
    }

    if (select && !(groupBy && groupBy.length)) {
      select = Array.isArray(select) ? select : [select];
      output = (output as any[]).map((row) =>
        Object.entries(row).reduce((accum, [key, value]) => {
          if ((select as string[]).includes(key)) accum[key] = value;
          return accum;
        }, {} as Record<string, any>)
      );
    }

    if (docsOnly) return output as unknown as RawResult<R, D>;
    return { data: output, count } as RawResult<R, D>;
  }

  /**
   * @description Parses and converts errors to the decaf hierarchy
   * @summary Returns decaf errors unchanged, maps connection failures to
   * {@link ERPNextConnectionError} and everything else through
   * {@link parseERPNextError}.
   * @template V - The expected error type
   * @param {Error} err - The error to parse
   * @return {V} The parsed error
   */
  parseError<V extends BaseError>(err: Error): V {
    if (err instanceof BaseError) return err as V;
    const status = (err as { status?: unknown }).status;
    if (typeof status === "number")
      return parseERPNextError(status, (err as { data?: unknown }).data) as V;
    const message = err?.message ?? String(err);
    if (
      /ECONNREFUSED|ENOTFOUND|ETIMEDOUT|ENETUNREACH|network|fetch failed|aborted|timeout/i.test(
        message
      )
    )
      return new ERPNextConnectionError(err) as V;
    return new ERPNextError(err) as V;
  }

  /**
   * @description Creates a new statement builder for queries
   * @template M - The model type
   * @param {Partial<AdapterFlags>} [overrides] - Optional adapter flag overrides
   * @return {ERPNextStatement<M, any, ...>} A new statement builder
   */
  Statement<M extends Model<boolean>>(
    overrides?: Partial<AdapterFlags>
  ): ERPNextStatement<
    M,
    any,
    Adapter<any, any, RawERPNextQuery<M>, ERPNextContext>
  > {
    return new ERPNextStatement<
      M,
      any,
      Adapter<any, any, RawERPNextQuery<M>, ERPNextContext>
    >(this as any, overrides);
  }

  /**
   * @description Creates a new paginator for queries
   * @template M - The model type
   * @param {RawERPNextQuery} query - The query to paginate
   * @param {number} size - The page size
   * @param {Constructor<M>} clazz - The model constructor
   * @return {ERPNextPaginator<M>} A new paginator
   */
  Paginator<M extends Model<boolean>>(
    query: RawERPNextQuery,
    size: number,
    clazz: Constructor<M>
  ): ERPNextPaginator<M> {
    return new ERPNextPaginator(this, query, size, clazz);
  }

  /**
   * @description Creates a client-side name generator
   * @summary ERPNext assigns a document name when none is supplied, but the decaf
   * model contract requires a primary-key value before persistence. The adapter
   * therefore generates a unique name up front and sends it with the create so the
   * document keeps the identity the repository already handed to the caller. A
   * site that needs a specific naming series should supply `name` explicitly.
   * @param {SequenceOptions} options - The sequence options (its name seeds the prefix)
   * @return {Promise<Sequence>} A sequence that yields unique document names
   */
  override async Sequence(options: SequenceOptions): Promise<Sequence> {
    const prefix = String(options.name || "erpnext")
      .replace(/[^A-Za-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .toUpperCase();
    const next = (): string => {
      const runtime = globalThis as unknown as {
        crypto?: { randomUUID?: () => string };
      };
      const uuid =
        runtime.crypto?.randomUUID?.() ??
        `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`;
      return `${prefix}-${uuid}`.toUpperCase();
    };
    return {
      next: async () => next(),
      current: async () => next(),
      range: async (count: number) =>
        Array.from({ length: count }, () => next()),
    } as unknown as Sequence;
  }

  /**
   * @description Creates the ERPNext REST client
   * @summary Returns the already-created client when one exists (including through
   * a `for()` configuration-scoped proxy) so authentication state is not lost.
   * @return {ERPNextClient} The client
   */
  protected getClient(): ERPNextClient {
    if (this._erpClient) return this._erpClient;
    const client = new ERPNextClient(this.config);
    this._erpClient = client;
    return client;
  }

  /**
   * @description Collects the defined values of a field across records
   * @summary Helper for aggregate evaluation; `undefined` and `null` entries are
   * skipped so they do not skew `SUM`/`AVG` calculations.
   * @param {any[]} records - The records to inspect
   * @param {string} field - The field name
   * @return {any[]} The defined field values
   */
  private numericValues(records: any[], field: string): any[] {
    return records
      .map((record) => record[field])
      .filter((value) => value !== undefined && value !== null);
  }

  /**
   * @description Compares two aggregate values for ordering
   * @summary Dates are compared by epoch time and bigints are coerced to numbers,
   * keeping `MIN`/`MAX` consistent across the supported attribute types.
   * @param {any} value - First value
   * @param {any} other - Second value
   * @return {number} Negative, zero or positive comparison result
   */
  private compareAggregate(value: any, other: any): number {
    const toComparable = (input: any): number =>
      input instanceof Date
        ? input.getTime()
        : typeof input === "bigint"
          ? Number(input)
          : Number(input);
    return toComparable(value) - toComparable(other);
  }

  /**
   * @description Groups records by one or more selectors
   * @summary Builds the nested result shape used by `GROUP BY` queries; each
   * selector level becomes a key level in the returned record tree.
   * @param {any[]} records - The records to group
   * @param {(keyof Model)[]} selectors - Ordered grouping attributes
   * @return {Record<string, any>} The grouped record tree
   */
  private groupRecords(
    records: any[],
    selectors: (keyof Model)[]
  ): Record<string, any> {
    if (!selectors.length) return records as unknown as Record<string, any>;
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
   * @description Normalizes a grouping value into a stable record key
   * @summary `null`, `undefined`, symbols and objects are all coerced to a stable
   * string, with objects serialized as JSON where possible.
   * @param {any} value - The grouping value
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
   * @description Applies `skip`/`limit` to a grouped result
   * @summary Paginates the top-level group keys without touching the nested
   * group contents.
   * @param {Record<string, any>} grouped - The grouped record tree
   * @param {number} [skip] - Number of group keys to skip
   * @param {number} [limit] - Maximum number of group keys to keep
   * @return {Record<string, any>} The paginated group tree
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
    for (const key of keys.slice(start, end)) paged[key] = grouped[key];
    return paged;
  }

  /**
   * @description Asserts a model field satisfies a type predicate
   * @summary Resolves the field metadata type and throws {@link QueryError} when
   * it is unknown or does not match the aggregate requirement.
   * @param {Constructor<Model>} clazz - The model constructor
   * @param {string} field - The attribute name
   * @param {string} context - Aggregate name used in the error message
   * @param {function(string): boolean} predicate - Allowed type predicate
   * @param {string} description - Human readable allowed types for the error
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
    if (!type || !predicate(type))
      throw new QueryError(
        `${context} requires ${description} attribute, but "${field}" is ${
          type || "unknown"
        }`
      );
  }

  /**
   * @description Resolves the normalized metadata type of a model field
   * @summary Reads the decorated type first and falls back to the reflected
   * design type.
   * @param {Constructor<Model>} clazz - The model constructor
   * @param {string} field - The attribute name
   * @return {string|undefined} The normalized type name, or `undefined`
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
   * @description Normalizes a metadata type descriptor to its lower-case name
   * @param {any} metaType - The metadata type (string or constructor)
   * @return {string|undefined} The normalized type name, or `undefined`
   */
  private normalizeMetaType(metaType: any): string | undefined {
    if (!metaType) return undefined;
    if (typeof metaType === "string") return metaType.toLowerCase();
    if (typeof metaType === "function" && metaType.name)
      return metaType.name.toLowerCase();
    return undefined;
  }

  /**
   * @description Checks whether a normalized type name is numeric
   * @param {string} [type] - The normalized type name
   * @return {boolean} `true` for `number` and `bigint`
   */
  private isNumericType(type?: string): boolean {
    return type === "number" || type === "bigint";
  }

  /**
   * @description Coerces an aggregate operand to a number
   * @summary Accepts numbers and bigints and throws {@link QueryError} for any
   * other type, so non-numeric data cannot silently corrupt aggregate results.
   * @param {any} value - The operand value
   * @param {string} field - The field name used in the error message
   * @param {string} context - Aggregate name used in the error message
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
   * @description Registers ERPNext-specific decorations for model properties
   * @summary Configures `createdBy` and `updatedBy` handlers for the ERPNext
   * flavour so those attributes are populated from the context UUID.
   * @return {void}
   */
  static override decoration(): void {
    super.decoration();
    const createdByKey = PersistenceKeys.CREATED_BY;
    const updatedByKey = PersistenceKeys.UPDATED_BY;
    Decoration.flavouredAs(ERPNextFlavour)
      .for(createdByKey)
      .define(
        onCreate(createdByOnERPNextCreateUpdate),
        propMetadata(createdByKey, {}),
        generated(createdByKey)
      )
      .apply();
    Decoration.flavouredAs(ERPNextFlavour)
      .for(updatedByKey)
      .define(
        onCreateUpdate(createdByOnERPNextCreateUpdate),
        propMetadata(updatedByKey, {}),
        generated(updatedByKey)
      )
      .apply();
  }
}

ERPNextAdapter.decoration();
