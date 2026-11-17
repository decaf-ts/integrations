import { Repository } from "@decaf-ts/core";
import { Model } from "@decaf-ts/decorator-validation";
import type { Constructor } from "@decaf-ts/decoration";
import type { ERPNextAdapter } from "./adapter";

/**
 * @description Standard-API repository bound to an ERPNext doctype
 * @summary Extends the core {@link Repository} so every standard repository
 * operation (`create`, `read`, `update`, `delete`, `findBy`, `page`, ...) runs
 * through the {@link ERPNextAdapter}. The ERPNext doctype is resolved from the
 * model's `@table` decoration; `doctype` exposes it for callers that need to build
 * Frappe-specific requests.
 *
 * It is the repository returned by {@link ERPNextAdapter.repository}, so
 * `Repository.forModel(ERPNextCustomer)` yields an instance of this class.
 * @template M - The model type
 * @template A - The ERPNext adapter type
 * @class ERPNextRepository
 * @category ERPNext
 * @example
 * ```typescript
 * const customer = await Repository.forModel(ERPNextCustomer);
 * await customer.create(new ERPNextCustomer({ customer_name: "ACME" }));
 * ```
 */
export class ERPNextRepository<
  M extends Model,
  A extends ERPNextAdapter = ERPNextAdapter,
> extends Repository<M, A> {
  protected override _overrides = Object.assign({}, super["_overrides"], {
    allowRawStatements: true,
  });

  /**
   * @description Creates a repository bound to an adapter and model
   * @param {A} adapter - The ERPNext adapter
   * @param {Constructor<M>} [clazz] - The model constructor
   */
  constructor(adapter: A, clazz?: Constructor<M>) {
    super(adapter, clazz);
  }

  /**
   * @description The ERPNext doctype backing this repository
   * @summary Resolved from the model table name, which ERPNext models set to the
   * exact doctype (`@table("Sales Invoice")`).
   * @return {string} The doctype
   */
  get doctype(): string {
    return Model.tableName(this.class);
  }

  /**
   * @description The REST client shared by the bound adapter
   * @summary Exposes the low-level {@link ERPNextClient} so callers can issue
   * Frappe requests that fall outside the standard repository API.
   * @return {ERPNextClient} The adapter REST client
   */
  get client() {
    return this.adapter.client;
  }
}
