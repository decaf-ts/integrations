/**
 * @module integrations/redis
 * @summary Redis (and Redis-compatible, e.g. DragonflyDB) persistence adapter.
 * @description Re-exports the Redis adapter, repository, query statement/paginator,
 * event dispatch, transaction lock and serialization helpers. The adapter is
 * exported last so its side-effect registration (flavour + decorations) runs after
 * the supporting modules are loaded.
 */
export * from "./constants";
export * from "./types";
export * from "./serialization";
export * from "./RedisContextLock";
export * from "./RedisDispatch";
export * from "./RedisStatement";
export * from "./RedisPaginator";
export * from "./handlers";
// Left to the end on purpose: importing the adapter registers the flavour
export * from "./adapter";
