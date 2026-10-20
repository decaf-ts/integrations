/**
 * @module integrations/tests/unit/redis/tls
 * @summary SAA-1062 (SAA-1044 F8): proves `RedisConfig.tls` reaches the
 * node-redis client factory and never weakens certificate verification by
 * default.
 */
import { describe, it, expect, jest, beforeAll } from "@jest/globals";

const createClient = jest.fn((options: Record<string, unknown>) => ({
  options,
  isOpen: false,
  connect: async () => undefined,
  quit: async () => undefined,
}));

class WatchError extends Error {}

jest.unstable_mockModule("redis", () => ({ createClient, WatchError }));

type AdapterModule = typeof import("../../../src/redis/adapter");

let RedisAdapter: AdapterModule["RedisAdapter"];

beforeAll(async () => {
  ({ RedisAdapter } = await import("../../../src/redis/adapter"));
});

function clientOptionsAfter(config: Record<string, unknown>): Record<string, any> {
  createClient.mockClear();
  const adapter = new RedisAdapter(
    { host: "cache.internal", port: 6380, ...config },
    `saa1062-${Math.random()}`
  );
  (adapter as unknown as { getClient(): unknown }).getClient();
  expect(createClient).toHaveBeenCalledTimes(1);
  return createClient.mock.calls[0][0] as Record<string, any>;
}

describe("RedisAdapter TLS configuration (SAA-1044 F8)", () => {
  it("forwards tls:true without an explicit rejectUnauthorized override", () => {
    const options = clientOptionsAfter({ tls: true });
    expect(options.socket).toEqual({
      host: "cache.internal",
      port: 6380,
      tls: true,
    });
    expect(options.socket).not.toHaveProperty("rejectUnauthorized");
  });

  it("forwards explicit tls.connect options", () => {
    const options = clientOptionsAfter({
      tls: { rejectUnauthorized: true, servername: "cache.internal" },
    });
    expect(options.socket).toMatchObject({
      host: "cache.internal",
      port: 6380,
      tls: true,
      rejectUnauthorized: true,
      servername: "cache.internal",
    });
  });

  it("leaves TLS off when the config does not enable it", () => {
    const options = clientOptionsAfter({});
    expect(options.socket).toEqual({ host: "cache.internal", port: 6380 });
    expect(options.socket).not.toHaveProperty("tls");
  });
});
