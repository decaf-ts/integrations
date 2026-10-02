import { Model } from "@decaf-ts/decorator-validation";
import { Constructor } from "@decaf-ts/decoration";
import { AdapterFlags, Context } from "@decaf-ts/core";

/**
 * @description Connection configuration accepted by {@link RedisAdapter}
 * @summary Supports both a full connection URL and the individual host/port/
 * credential fields. When `url` is provided it takes precedence over the
 * discrete fields.
 * @typedef {object} RedisConfig
 * @property {string} [url] Full redis:// connection string
 * @property {string} [host] Server host (defaults to localhost)
 * @property {number} [port] Server port (defaults to 6379)
 * @property {string} [username] ACL username
 * @property {string} [password] ACL password
 * @property {number} [database] Logical database index
 * @property {string} [prefix] Key namespace (defaults to decaf:redis)
 * @property {string} [user] Identity reported on created/updated records
 * @memberOf module:redis
 */
export type RedisConfig = {
  url?: string;
  host?: string;
  port?: number;
  username?: string;
  password?: string;
  database?: number;
  prefix?: string;
  user?: string;
};

/**
 * @description Adapter flags enriched with the acting user identity
 * @summary Extends the base adapter flags with the `UUID` field used by the
 * `createdBy`/`updatedBy` decorators.
 * @interface RedisFlags
 * @extends AdapterFlags
 * @property {string} UUID Identity of the user performing the operation
 * @memberOf module:redis
 */
export interface RedisFlags extends AdapterFlags {
  UUID: string;
}

/**
 * @description Contextual type used by the Redis adapter
 * @typedef {Context<RedisFlags>} RedisContext
 * @memberOf module:redis
 */
export type RedisContext = Context<RedisFlags>;

/**
 * @description Raw query descriptor applied in memory by the Redis adapter
 * @summary Mirrors the in-memory query shape of the core RAM adapter. The Redis
 * adapter loads the matching table, reverts records to models and evaluates the
 * predicate/sort/aggregation functions in JavaScript.
 * @typedef {object} RawRedisQuery
 * @template M
 * @memberOf module:redis
 */
export type RawRedisQuery<M extends Model = any> = {
  select: undefined | (keyof M)[];
  from: Constructor<M>;
  where: (el: M) => boolean;
  sort?: (el: M, el2: M) => number;
  groupBy?: (keyof M)[];
  limit?: number;
  skip?: number;
  count?: keyof M | null;
  countDistinct?: keyof M;
  min?: keyof M;
  max?: keyof M;
  sum?: keyof M;
  avg?: keyof M;
  distinct?: keyof M;
};
