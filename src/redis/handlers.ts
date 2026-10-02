import { Model } from "@decaf-ts/decorator-validation";
import { RelationsMetadata } from "@decaf-ts/core";
import { ContextOf, UnsupportedError } from "@decaf-ts/core";
import type { RedisRepository } from "./RedisRepository";

/**
 * @description Sets the created by field on a model during Redis create/update operations
 * @summary Automatically populates a model field with the UUID from the context during create or update operations.
 * This function is designed to be used as a handler for Redis operations to track entity creation.
 * @template M - Type of the model being created/updated
 * @template R - Type of the repository handling the model
 * @param {R} this - The repository instance
 * @param {Context} context - The operation context containing user identification
 * @param {RelationsMetadata} data - The relations metadata
 * @param {keyof M} key - The property key to set with the UUID
 * @param {M} model - The model instance being created/updated
 * @return {Promise<void>} A promise that resolves when the field has been set
 * @function createdByOnRedisCreateUpdate
 * @memberOf module:redis
 */
export async function createdByOnRedisCreateUpdate<
  M extends Model,
  R extends RedisRepository<M>,
>(
  this: R,
  context: ContextOf<R>,
  data: RelationsMetadata,
  key: keyof M,
  model: M
): Promise<void> {
  const uuid: string = context.get("UUID");
  if (!uuid)
    throw new UnsupportedError(
      "This adapter does not support user identification"
    );
  model[key] = uuid as M[keyof M];
}
