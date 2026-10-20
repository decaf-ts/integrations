/**
 * @module integrations/tests/secrets-name-uniqueness
 * @summary Live Postgres coverage for the `secrets (name, version)` uniqueness migration.
 * @description Applies `sql/004_credentials.sql` to an isolated Postgres 16
 * database and verifies the unique index rejects duplicate `(name, version)`
 * rows (including `NULL`/`''` equivalence), accepts distinct versions, blocks
 * conflicting updates, replaying the migration is idempotent, and the fail-closed
 * `DO` guard refuses to migrate a database that still holds legacy duplicates.
 */
import { jest } from "@jest/globals";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

jest.setTimeout(60_000);

const testDirname = dirname(fileURLToPath(import.meta.url));
const fixturePath = resolve(
  testDirname,
  "../namespaces/fixtures/postgres-rls-schema.sql"
);
const migrationPath = resolve(testDirname, "../../../sql/004_credentials.sql");

const DEFAULT_PG_URL =
  "postgresql://decaf:decaf-integration@localhost:55435/decaf_integration";
const BASE_PG_URL = process.env.DECAF_PG_URL || DEFAULT_PG_URL;
const DATABASE_NAME = `decaf_secrets_uniqueness_${process.pid}`;

const migrationSql = readFileSync(migrationPath, "utf8");
const schemaSql = readFileSync(fixturePath, "utf8");

let adminClient: pg.Client;
let client: pg.Client;

function urlForDatabase(database: string): string {
  const url = new URL(BASE_PG_URL);
  url.pathname = `/${database}`;
  return url.toString();
}

function quoteIdentifier(identifier: string): string {
  return `"${identifier.replace(/"/g, '""')}"`;
}

async function insertSecret(
  name: string,
  version: string | null
): Promise<string> {
  const id = randomUUID();
  await client.query(
    `INSERT INTO secrets (id, name, provider, encrypted_payload, encryption, version)
     VALUES ($1, $2, 'model', 'ciphertext', $3::jsonb, $4)`,
    [id, name, JSON.stringify({ keyId: "k1", iv: "iv", salt: "salt" }), version]
  );
  return id;
}

async function applyMigration(): Promise<void> {
  await client.query(migrationSql);
}

beforeAll(async () => {
  adminClient = new pg.Client({
    connectionString: BASE_PG_URL,
    connectionTimeoutMillis: 5_000,
  });
  try {
    await adminClient.connect();
  } catch (error) {
    throw new Error(
      `Postgres is unreachable at ${BASE_PG_URL}; start docker/postgres-compose.yml (run: npm run prepare-it-tests). ${(error as Error).message}`
    );
  }

  await adminClient.query(
    `DROP DATABASE IF EXISTS ${quoteIdentifier(DATABASE_NAME)} WITH (FORCE)`
  );
  await adminClient.query(`CREATE DATABASE ${quoteIdentifier(DATABASE_NAME)}`);

  client = new pg.Client({
    connectionString: urlForDatabase(DATABASE_NAME),
    connectionTimeoutMillis: 5_000,
  });
  await client.connect();
  await client.query(schemaSql);
});

afterAll(async () => {
  if (client) {
    try {
      await client.end();
    } catch {
      // already closed
    }
  }

  if (adminClient) {
    try {
      await adminClient.query(
        `DROP DATABASE IF EXISTS ${quoteIdentifier(DATABASE_NAME)} WITH (FORCE)`
      );
    } catch {
      // leave the uniquely-named throwaway database for operator cleanup
    }
    try {
      await adminClient.end();
    } catch {
      // already closed
    }
  }
});

describe("sql/004_credentials.sql secrets uniqueness", () => {
  it("creates the unique (name, version) index and drops the old name index", async () => {
    await applyMigration();

    const indexes = await client.query(
      `SELECT indexname, indexdef FROM pg_indexes WHERE tablename = 'secrets'`
    );
    const byName = Object.fromEntries(
      indexes.rows.map((row) => [row.indexname, row.indexdef])
    );

    expect(byName).not.toHaveProperty("ix_secrets_name");
    expect(byName).toHaveProperty("uq_secrets_name_version");
    expect(byName.uq_secrets_name_version).toMatch(/UNIQUE INDEX/);
    expect(byName.uq_secrets_name_version).toMatch(
      /name, COALESCE\(version, ''::text\)/
    );
  });

  it("rejects a duplicate (name, NULL version) insert", async () => {
    await insertSecret("pg-duplicate-null", null);

    const failure = await insertSecret("pg-duplicate-null", null).catch(
      (error) => error
    );

    expect(failure).toBeInstanceOf(Error);
    expect((failure as { code?: string }).code).toBe("23505");
    const rows = await client.query(
      `SELECT count(*)::int AS total FROM secrets WHERE name = $1`,
      ["pg-duplicate-null"]
    );
    expect(rows.rows[0].total).toBe(1);
  });

  it("treats NULL and an empty version as the same version", async () => {
    await insertSecret("pg-null-vs-empty", null);

    const failure = await insertSecret("pg-null-vs-empty", "").catch(
      (error) => error
    );

    expect((failure as { code?: string }).code).toBe("23505");
  });

  it("accepts the same name at different versions", async () => {
    await insertSecret("pg-versioned", "v1");
    await insertSecret("pg-versioned", "v2");

    const rows = await client.query(
      `SELECT version FROM secrets WHERE name = $1 ORDER BY version`,
      ["pg-versioned"]
    );
    expect(rows.rows.map((row) => row.version)).toEqual(["v1", "v2"]);
  });

  it("rejects an update that collides with another row's (name, version)", async () => {
    const first = await insertSecret("pg-update-conflict", "v1");
    await insertSecret("pg-update-conflict", "v2");

    const failure = await client
      .query(`UPDATE secrets SET version = 'v2' WHERE id = $1`, [first])
      .catch((error) => error);

    expect((failure as { code?: string }).code).toBe("23505");
    const rows = await client.query(
      `SELECT version FROM secrets WHERE name = $1 ORDER BY version`,
      ["pg-update-conflict"]
    );
    expect(rows.rows.map((row) => row.version)).toEqual(["v1", "v2"]);
  });

  it("replays idempotently on an already-migrated database", async () => {
    await expect(applyMigration()).resolves.toBeUndefined();

    const indexes = await client.query(
      `SELECT indexname FROM pg_indexes WHERE tablename = 'secrets' AND indexname = 'uq_secrets_name_version'`
    );
    expect(indexes.rows).toHaveLength(1);
  });

  it("refuses to migrate when legacy duplicates exist", async () => {
    await client.query(`DROP INDEX IF EXISTS uq_secrets_name_version`);
    await client.query(
      `CREATE INDEX IF NOT EXISTS ix_secrets_name ON secrets (name)`
    );
    const legacy = "pg-legacy-duplicate";
    await insertSecret(legacy, "v1");
    await insertSecret(legacy, "v1");

    const failure = await applyMigration().catch((error) => error);

    expect(failure).toBeInstanceOf(Error);
    expect((failure as Error).message).toMatch(/duplicate rows exist/i);
    expect((failure as Error).message).toContain(legacy);
    expect((failure as Error).message).toContain("version=v1");

    const indexes = await client.query(
      `SELECT indexname FROM pg_indexes WHERE tablename = 'secrets' AND indexname = 'uq_secrets_name_version'`
    );
    expect(indexes.rows).toHaveLength(0);

    await client.query(`DELETE FROM secrets WHERE name = $1`, [legacy]);
    await client.query(`DROP INDEX IF EXISTS ix_secrets_name`);
    await expect(applyMigration()).resolves.toBeUndefined();
  });
});
