/**
 * @description Marker used to encode JavaScript Date values in JSON payloads
 * @const RedisDateMarker
 * @memberOf module:redis
 */
export const RedisDateMarker = "__decaf_redis_date__";

/**
 * @description Marker used to encode JavaScript bigint values in JSON payloads
 * @const RedisBigIntMarker
 * @memberOf module:redis
 */
export const RedisBigIntMarker = "__decaf_redis_bigint__";

/**
 * @description Serializes a record for storage in Redis
 * @summary JSON-encodes a value while preserving types that JSON cannot represent
 * natively. `Date` instances are encoded as an ISO string under a marker key and
 * `bigint` values are encoded as decimal strings under a marker key so they can be
 * revived by {@link deserialize} without loss.
 * @param {any} value - The value to serialize
 * @return {string} The serialized JSON string
 * @function serialize
 * @memberOf module:redis
 */
export function serialize(value: any): string {
  return JSON.stringify(value, function (this: any, key, val) {
    const original = this ? this[key] : val;
    if (original instanceof Date)
      return {
        [RedisDateMarker]: Date.prototype.toISOString.call(original),
      };
    if (typeof val === "bigint")
      return { [RedisBigIntMarker]: val.toString() };
    return val;
  });
}

/**
 * @description Deserializes a record read from Redis
 * @summary JSON-decodes a value produced by {@link serialize}, restoring `Date`
 * and `bigint` instances from their marker representations.
 * @template T - The expected result type
 * @param {string} raw - The serialized JSON string
 * @return {T} The deserialized value
 * @function deserialize
 * @memberOf module:redis
 */
export function deserialize<T = any>(raw: string): T {
  return JSON.parse(raw, (_key, val) => {
    if (val && typeof val === "object") {
      if (RedisDateMarker in val) return new Date(val[RedisDateMarker]);
      if (RedisBigIntMarker in val)
        return BigInt(val[RedisBigIntMarker] as string);
    }
    return val;
  }) as T;
}
