/**
 * @description Identifier for the Redis database flavour
 * @summary Constant string that identifies the persistence adapter as "redis" for
 * use in adapter selection and decoration. The same flavour serves Redis and any
 * Redis-compatible server such as DragonflyDB.
 * @const RedisFlavour
 * @memberOf module:redis
 */
export const RedisFlavour = "redis";

/**
 * @description Default key namespace used by the Redis adapter
 * @summary Every key the adapter writes is namespaced under this prefix so a
 * single Redis database can be shared by several decaf applications without
 * collisions.
 * @const RedisDefaultPrefix
 * @memberOf module:redis
 */
export const RedisDefaultPrefix = "decaf:redis";

/**
 * @description Redis pub/sub channel used to broadcast observer events
 * @summary Channel on which the adapter publishes record change events so that
 * every process sharing the database can refresh its observers.
 * @const RedisEventsChannel
 * @memberOf module:redis
 */
export const RedisEventsChannel = "decaf:redis:events";
