import { ContextOf, RelationsMetadata, Repository, UnsupportedError } from "@decaf-ts/core";
import type { Model } from "@decaf-ts/decorator-validation";
import type { ERPNextAdapter } from "./adapter";

/**
 * @description Sets the created/updated by field from the context identity
 * @summary Populates a model attribute with the `UUID` carried by the operation
 * context. Registered by {@link ERPNextAdapter.decoration} for the `createdBy`
 * and `updatedBy` decorations so those fields are filled from the caller identity
 * instead of relying on the server-managed Frappe `owner` field.
 * @template M - The model type being created/updated
 * @template R - The repository handling the model
 * @param {R} this - The repository instance
 * @param {ContextOf<R>} context - The operation context
 * @param {RelationsMetadata} data - The relation metadata
 * @param {keyof M} key - The attribute to set
 * @param {M} model - The model instance
 * @return {Promise<void>} A promise that resolves once the field is set
 * @function createdByOnERPNextCreateUpdate
 * @memberOf module:erpnext
 */
export async function createdByOnERPNextCreateUpdate<
  M extends Model,
  R extends Repository<M, ERPNextAdapter>,
>(
  this: R,
  context: ContextOf<R>,
  data: RelationsMetadata,
  key: keyof M,
  model: M
): Promise<void> {
  const uuid: string = context.get("UUID") as string;
  if (!uuid)
    throw new UnsupportedError(
      "This adapter does not support user identification"
    );
  model[key] = uuid as M[keyof M];
}
