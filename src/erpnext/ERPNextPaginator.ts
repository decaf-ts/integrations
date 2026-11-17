import {
  Adapter,
  MaybeContextualArg,
  Paginator,
  RawResult,
} from "@decaf-ts/core";
import { Model } from "@decaf-ts/decorator-validation";
import type { Constructor } from "@decaf-ts/decoration";
import { RawERPNextQuery } from "./types";

/**
 * @description ERPNext-specific paginator
 * @summary Paginates a {@link RawERPNextQuery} executed by the ERPNext adapter. The
 * first call counts the matching documents and then requests the concrete page with
 * the appropriate offset.
 * @template M - The model type being paginated
 * @class ERPNextPaginator
 * @category ERPNext
 * @example
 * ```typescript
 * const paginator = adapter.Paginator<ERPNextCustomer>(
 *   { from: ERPNextCustomer },
 *   10,
 *   ERPNextCustomer
 * );
 * const firstPage = await paginator.page(1);
 * ```
 */
export class ERPNextPaginator<M extends Model> extends Paginator<
  M,
  M[],
  RawERPNextQuery<M>
> {
  /**
   * @description Creates a paginator bound to the ERPNext adapter
   * @param {Adapter<any, any, RawERPNextQuery<M>, any>} adapter - The ERPNext adapter
   * @param {RawERPNextQuery<M>} query - The raw query to paginate
   * @param {number} size - The number of records per page
   * @param {Constructor<M>} clazz - The model constructor being paginated
   */
  constructor(
    adapter: Adapter<any, any, RawERPNextQuery<M>, any>,
    query: RawERPNextQuery<M>,
    size: number,
    clazz: Constructor<M>
  ) {
    super(adapter, query, size, clazz);
  }

  /**
   * @description Prepares the query with the page length
   * @param {RawERPNextQuery<M>} rawStatement - The original query
   * @return {RawERPNextQuery<M>} The query with `limit` set to the page size
   */
  protected prepare(rawStatement: RawERPNextQuery<M>): RawERPNextQuery<M> {
    const query: RawERPNextQuery<M> = Object.assign({}, rawStatement);
    query.limit = this.size;
    return query;
  }

  /**
   * @description Retrieves a specific page of results
   * @summary Counts the matching documents on the first call, then requests the
   * page using the calculated offset.
   * @param {number} [page=1] - The 1-based page number
   * @return {Promise<M[]>} The records for the requested page
   */
  override async page(
    page: number = 1,
    ...args: MaybeContextualArg<any>
  ): Promise<M[]> {
    const { ctx, ctxArgs } = this.adapter["logCtx"](args, this.page);
    if (this.isPreparedStatement()) return this.pagePrepared(page, ...ctxArgs);

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
