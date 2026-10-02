import net from "node:net";
import { readFileSync } from "node:fs";
import { Constructor } from "@decaf-ts/decoration";
import { Model } from "@decaf-ts/decorator-validation";
import { RedisAdapter, RedisDefaultPrefix, RedisRepository } from "../../src/redis";

export type RedisTestResources = {
  adapter: RedisAdapter;
  prefix: string;
  url: string;
};

let counter = 0;

function randomSuffix() {
  counter += 1;
  return `${Date.now().toString(36)}_${counter}_${Math.random()
    .toString(36)
    .slice(2, 8)}`;
}

function gatewayUrls(): string[] {
  const urls: string[] = [];
  try {
    const route = readFileSync("/proc/net/route", "utf8");
    for (const line of route.split("\n").slice(1)) {
      const parts = line.trim().split(/\s+/);
      if (parts.length < 3 || parts[1] !== "00000000") continue;
      const octets = parts[2].match(/../g)?.reverse();
      if (octets && octets.length === 4)
        urls.push(`redis://${octets.map((o) => parseInt(o, 16)).join(".")}:6379`);
    }
  } catch {
    // not on Linux or no route table; the other candidates still apply
  }
  return urls;
}

function candidateUrls(): string[] {
  return [
    process.env.REDIS_URL,
    "redis://localhost:6379",
    ...gatewayUrls(),
    "redis://decaf-redis-integration:6379",
    "redis://dragonfly:6379",
  ].filter((url): url is string => !!url);
}

function isReachable(url: string, timeoutMs = 750): Promise<boolean> {
  let host: string;
  let port: number;
  try {
    const parsed = new URL(url);
    host = parsed.hostname;
    port = Number(parsed.port || 6379);
  } catch {
    return Promise.resolve(false);
  }
  return new Promise((resolve) => {
    const socket = net.connect({ host, port });
    const finish = (ok: boolean) => {
      socket.removeAllListeners();
      socket.destroy();
      resolve(ok);
    };
    socket.setTimeout(timeoutMs);
    socket.once("connect", () => finish(true));
    socket.once("timeout", () => finish(false));
    socket.once("error", () => finish(false));
  });
}

let resolved: string | undefined;

/**
 * Resolves the Redis endpoint. `REDIS_URL` wins; otherwise the candidates are
 * probed so the suite works both when the test process shares the Docker host
 * network (`localhost`) and when it runs in a sibling container that can only
 * reach published ports through the Docker bridge gateway.
 */
export async function resolveRedisUrl(): Promise<string> {
  if (resolved) return resolved;
  for (const url of candidateUrls()) {
    if (await isReachable(url)) {
      resolved = url;
      return url;
    }
  }
  throw new Error(
    `No reachable Redis server. Tried: ${candidateUrls().join(", ")}. ` +
      `Boot it with "npm run prepare-it-tests" or set REDIS_URL.`
  );
}

/**
 * Boots a Redis adapter namespaced under a unique key prefix so concurrent test
 * files never collide on the shared DragonflyDB instance.
 */
export async function setupRedisAdapter(
  prefix: string,
  alias?: string
): Promise<RedisTestResources> {
  const url = await resolveRedisUrl();
  const namespace = `${RedisDefaultPrefix}:test:${prefix}:${randomSuffix()}`;
  const adapter = new RedisAdapter({ url, prefix: namespace }, alias);
  await adapter.initialize();
  return { adapter, prefix: namespace, url };
}

export function redisRepository<M extends Model>(
  adapter: RedisAdapter,
  model: Constructor<M>,
  force = true
): RedisRepository<M> {
  return new RedisRepository(adapter, model, force);
}

export async function cleanupRedisTestResources(
  resources: RedisTestResources | undefined
): Promise<void> {
  if (!resources) return;
  const { adapter, prefix } = resources;
  try {
    const client = adapter.client;
    const keys = await client.keys(`${prefix}*`);
    if (keys.length) await client.del(keys);
  } catch {
    // best-effort cleanup; the adapter shutdown below still runs
  }
  await adapter.shutdown();
}
