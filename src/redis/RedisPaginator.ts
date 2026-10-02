import { RawRedisQuery } from "./types";
import {
  Adapter,
  MaybeContextualArg,
  Paginator,
  RawResult,
} from "@decaf-ts/core";
import { Model } from "@decaf-ts/decorator-validation";
import type { Constructor } from "@decaf-ts/decoration";

/**
 * @description Redis-specific paginator implementation
 * @summary Extends the base Paginator class to provide pagination functionality for
 * Redis adapter queries. This class handles the pagination of query results loaded
 * from Redis, allowing for efficient retrieval of large result sets in smaller chunks.
 * @template M - The model type being paginated
 * @class RedisPaginator
 * @category Redis
 * @example
 * ```typescript
 * // Create a query for User model
 * const query: RawRedisQuery<User> = {
 *   select: undefined, // Select all fields
 *   from: User,
 *   where: (user) => user.active === true
 * };
 *
 * // Create a paginator with page size of 10
 * const paginator = new RedisPaginator<User>(adapter, query, 10, User);
 *
 * // Get the first page of results
 * const firstPage = await paginator.page(1);
 *
 * // Get the next page
 * const secondPage = await paginator.page(2);
 * ```
 */
export class RedisPaginator<M extends Model> extends Paginator<
  M,
  M[],
  RawRedisQuery<M>
> {
  /**
   * @description Creates a paginator bound to the Redis adapter
   * @param {Adapter<any, any, RawRedisQuery<M>, any>} adapter - The Redis adapter instance
   * @param {RawRedisQuery<M>} query - The raw query to paginate
   * @param {number} size - The number of records per page
   * @param {Constructor<M>} clazz - The model constructor being paginated
   */
  constructor(
    adapter: Adapter<any, any, RawRedisQuery<M>, any>,
    query: RawRedisQuery<M>,
    size: number,
    clazz: Constructor<M>
  ) {
    super(adapter, query, size, clazz);
  }

  /**
   * @description Prepares a Redis query for pagination
   * @summary Modifies the raw query statement to include pagination parameters.
   * This protected method sets the limit parameter on the query to match the page size.
   * @param {RawRedisQuery<M>} rawStatement - The original query statement
   * @return {RawRedisQuery<M>} The modified query with pagination parameters
   */
  protected prepare(rawStatement: RawRedisQuery<M>): RawRedisQuery<M> {
    const query: RawRedisQuery<any> = Object.assign({}, rawStatement);
    query.limit = this.size;
    return query;
  }

  /**
   * @description Retrieves a specific page of results
   * @summary Executes the query with pagination parameters to retrieve a specific page of results.
   * This method calculates the appropriate skip value based on the page number and page size,
   * executes the query, and updates the current page tracking.
   * @param {number} [page=1] - The page number to retrieve (1-based)
   * @return {Promise<R[]>} A promise that resolves to an array of results for the requested page
   */
  override async page(
    page: number = 1,
    ...args: MaybeContextualArg<any>
  ): Promise<M[]> {
    const { ctx, ctxArgs } = this.adapter["logCtx"](args, this.page);
    if (this.isPreparedStatement()) {
      return this.pagePrepared(page, ...ctxArgs);
    }

    const statement = this.prepare(this.statement);
    let results: RawResult<any, any>;
    if (!this._recordCount || !this._totalPages) {
      this._totalPages = this._recordCount = 0;
      results = await this.adapter.raw<any, false>(
        { ...statement, limit: Number.MAX_SAFE_INTEGER },
        false,
        ctx
      );
      this._recordCount = results.count || results.data.length;
      if (this._recordCount > 0) {
        const size = statement?.limit || this.size;
        this._totalPages = Math.ceil(this._recordCount / size);
        return await this.page(page, ...ctxArgs);
      }
    } else {
      page = this.validatePage(page);
      statement.skip = (page - 1) * this.size;
      results = await this.adapter.raw<any, true>(statement, true, ...ctxArgs);
    }

    this._currentPage = page;
    this._bookmark = results.length
      ? results[results.length - 1][Model.pk(this.clazz)]
      : undefined;
    return results.data || results;
  }
}
