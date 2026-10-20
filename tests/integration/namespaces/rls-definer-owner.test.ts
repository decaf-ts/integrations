/**
 * @module integrations/tests/rls-definer-owner
 * @summary Live Postgres coverage for the RLS definer-owner BYPASSRLS guard.
 * @description Applies the namespace RLS template as the database owner, then
 * rebinds the session to a plain `NOSUPERUSER NOBYPASSRLS` role and proves a
 * second {@link RlsBootstrapService} bootstrap fails fast with
 * {@link RlsFunctionOwnerError} before executing any template DDL.
 */
import { jest } from "@jest/globals";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import {
  RlsBootstrapService,
  RlsFunctionOwnerError,
} from "../../../src/namespaces/rls/rls-bootstrap.service";
import { RLS_FUNCTION_OWNER_QUERY } from "../../../src/namespaces/rls/rls.constants";
import { rlsBootstrapStatements } from "../../../src/namespaces/rls/rls.template";

jest.setTimeout(120_000);

const testDirname = dirname(fileURLToPath(import.meta.url));
const fixturePath = resolve(
  testDirname,
  "fixtures/postgres-rls-schema.sql"
);

const DEFAULT_PG_URL =
  "postgresql://decaf:decaf-integration@localhost:55435/decaf_integration";
const BASE_PG_URL = process.env.DECAF_PG_URL || DEFAULT_PG_URL;
const DATABASE_NAME = `decaf_rls_owner_${process.pid}`;
const APP_ROLE = `rls_owner_app_${process.pid}`;

function urlForDatabase(database: string): string {
  const url = new URL(BASE_PG_URL);
  url.pathname = `/${database}`;
  return url.toString();
}

function quoteIdentifier(identifier: string): string {
  return `"${identifier.replace(/"/g, '""')}"`;
}

let adminClient: pg.Client;
let client: pg.Client;

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
  await client.query(readFileSync(fixturePath, "utf8"));
});

afterAll(async () => {
  if (client) {
    try {
      await client.query("RESET ROLE");
      await client.query(`DROP OWNED BY ${quoteIdentifier(APP_ROLE)}`);
    } catch {
      // database teardown below still removes the role
    }
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
      await adminClient.query(`DROP ROLE IF EXISTS ${quoteIdentifier(APP_ROLE)}`);
    } catch {
      // leave the uniquely-named role for operator cleanup
    }
    try {
      await adminClient.end();
    } catch {
      // already closed
    }
  }
});

describe("RLS definer-owner guard (Postgres)", () => {
  it("applies the template as the SUPERUSER database owner", async () => {
    const service = new RlsBootstrapService();
    await service.boot(client);

    const result = await service.apply();

    expect(result.applied).toBe(rlsBootstrapStatements().length);
    const marker = await client.query(
      "SELECT app_rls_principal_id() AS principal"
    );
    expect(marker.rows[0].principal).toBeNull();
  });

  it("rejects a NOBYPASSRLS executor before executing any template DDL", async () => {
    await client.query(
      `CREATE ROLE ${quoteIdentifier(APP_ROLE)} NOSUPERUSER NOBYPASSRLS`
    );
    await client.query(
      `GRANT USAGE ON SCHEMA public TO ${quoteIdentifier(APP_ROLE)}`
    );
    await client.query(`SET ROLE ${quoteIdentifier(APP_ROLE)}`);

    const identity = await client.query(
      `SELECT session_user, current_user,
              (SELECT rolsuper FROM pg_roles WHERE rolname = current_user) AS rolsuper,
              (SELECT rolbypassrls FROM pg_roles WHERE rolname = current_user) AS rolbypassrls`
    );
    expect(identity.rows[0]).toMatchObject({
      current_user: APP_ROLE,
      rolsuper: false,
      rolbypassrls: false,
    });

    const service = new RlsBootstrapService();
    await service.boot(client);
    const querySpy = jest.spyOn(client, "query");

    const failure = await service.apply().catch((error) => error);

    expect(failure).toBeInstanceOf(RlsFunctionOwnerError);
    expect((failure as Error).name).toBe("RlsFunctionOwnerError");
    expect((failure as Error).message).toMatch(/SUPERUSER/);
    expect((failure as Error).message).toMatch(/BYPASSRLS/);
    expect((failure as Error).message).toContain(APP_ROLE);
    expect(querySpy.mock.calls.map((call) => call[0])).toEqual([
      RLS_FUNCTION_OWNER_QUERY,
    ]);

    querySpy.mockRestore();
  });

  it("keeps the previously applied template intact after the rejected bootstrap", async () => {
    const rows = await client.query(
      `SELECT count(*)::int AS total FROM pg_policies WHERE schemaname = 'public'`
    );
    expect(rows.rows[0].total).toBeGreaterThan(0);
  });
});
