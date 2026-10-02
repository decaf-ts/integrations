import { Repository } from "@decaf-ts/core";
import { Model } from "@decaf-ts/decorator-validation";
import type { RedisAdapter } from "./adapter";

/**
 * @description Repository bound to the Redis adapter
 * @summary Thin alias of the core `Repository` bound to the Redis adapter. The
 * adapter adds no repository-level behavior, so the stock `Repository` flags
 * handling (including `override`) is used as-is.
 * @template M - The model type handled by this repository
 * @class RedisRepository
 * @category Redis
 */
export class RedisRepository<M extends Model> extends Repository<
  M,
  RedisAdapter
> {}
