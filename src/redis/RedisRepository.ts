import { ContextOf, FlagsOf, Repository } from "@decaf-ts/core";
import { Model } from "@decaf-ts/decorator-validation";
import { Constructor } from "@decaf-ts/decoration";
import type { RedisAdapter } from "./adapter";

/**
 * @description Repository bound to the Redis adapter
 * @summary Extends the core `Repository` for the Redis adapter. The only
 * Redis-specific behavior is {@link override}, which forwards adapter flags so
 * per-operation configuration (such as the acting user) can be applied.
 * @template M - The model type handled by this repository
 * @class RedisRepository
 * @category Redis
 */
export class RedisRepository<M extends Model> extends Repository<
  M,
  RedisAdapter
> {
  /**
   * @description Creates a repository bound to the Redis adapter
   * @param {RedisAdapter} adapter - The Redis adapter handling persistence
   * @param {Constructor<M>} model - The model constructor handled by this repository
   * @param {boolean} [force] - Whether to force repository creation even when one already exists
   */
  constructor(
    adapter: RedisAdapter,
    model: Constructor<M>,
    force: boolean = false
  ) {
    super(adapter, model, force);
  }

  /**
   * @description Creates a repository copy with per-operation flags
   * @summary Extends the base override so the provided flags are also applied as
   * context, forwarding adapter flags (such as the acting user `UUID`) to the
   * operation context.
   * @param {Partial<FlagsOf<ContextOf<RedisAdapter>>>} flags - The flags to apply
   * @return {Repository<M, RedisAdapter>} A repository copy bound to the given flags
   */
  override override(flags: Partial<FlagsOf<ContextOf<RedisAdapter>>>) {
    return super.override(flags).for(flags as unknown as never);
  }
}
