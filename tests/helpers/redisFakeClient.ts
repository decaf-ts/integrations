import { jest } from "@jest/globals";

export type FakeRedisClient = ReturnType<typeof createFakeRedisClient>;

/**
 * Minimal in-memory stand-in for a node-redis client, covering exactly the
 * surface the Redis adapter uses. Keeps a per-key hash so CRUD and raw queries
 * can be exercised without a live server.
 */
export function createFakeRedisClient() {
  const hashes = new Map<string, Map<string, string>>();

  const hashOf = (key: string) => {
    let hash = hashes.get(key);
    if (!hash) {
      hash = new Map();
      hashes.set(key, hash);
    }
    return hash;
  };

  return {
    hashes,
    isOpen: true,
    hSetNX: jest.fn(
      async (key: string, field: string, value: string): Promise<number> => {
        const hash = hashOf(key);
        if (hash.has(field)) return 0;
        hash.set(field, value);
        return 1;
      }
    ),
    hGet: jest.fn(
      async (key: string, field: string): Promise<string | null> => {
        const hash = hashes.get(key);
        return hash && hash.has(field) ? (hash.get(field) as string) : null;
      }
    ),
    hExists: jest.fn(
      async (key: string, field: string): Promise<boolean> =>
        hashes.get(key)?.has(field) ?? false
    ),
    hSet: jest.fn(
      async (key: string, field: string, value: string): Promise<number> => {
        hashOf(key).set(field, value);
        return 1;
      }
    ),
    hDel: jest.fn(
      async (key: string, field: string): Promise<number> =>
        hashes.get(key)?.delete(field) ? 1 : 0
    ),
    hGetAll: jest.fn(
      async (key: string): Promise<Record<string, string>> =>
        Object.fromEntries(hashes.get(key) ?? [])
    ),
    publish: jest.fn(async (): Promise<number> => 1),
    duplicate: jest.fn((): FakeRedisClient => createFakeRedisClient()),
    connect: jest.fn(async (): Promise<void> => undefined),
    quit: jest.fn(async (): Promise<void> => undefined),
    disconnect: jest.fn(async (): Promise<void> => undefined),
    subscribe: jest.fn(async (): Promise<void> => undefined),
    unsubscribe: jest.fn(async (): Promise<void> => undefined),
  };
}
