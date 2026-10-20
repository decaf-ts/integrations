/**
 * @module integrations/tests/rls-permission-matrix
 * @summary Postgres integration matrix for the namespace RLS template.
 * @description Applies the bundled template through
 * {@link RlsBootstrapService} into an isolated database, binds principals with
 * `app.principal_id`, and proves the reader/writer/admin and end-user visibility
 * rules against a real non-superuser, NOBYPASSRLS role.
 */
import { jest } from "@jest/globals";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import {
  RlsBootstrapService,
} from "../../../src/namespaces/rls/rls-bootstrap.service";
import {
  rlsBootstrapStatements,
} from "../../../src/namespaces/rls/rls.template";
import {
  RLS_PERMISSION_KEYS,
  RLS_ROLE_KEYS,
} from "../../../src/namespaces/rls/rls.constants";

jest.setTimeout(120_000);

const testDirname = dirname(fileURLToPath(import.meta.url));
const fixturePath = resolve(
  testDirname,
  "fixtures/postgres-rls-schema.sql"
);

const DEFAULT_PG_URL =
  "postgresql://decaf:decaf-integration@localhost:55435/decaf_integration";
const BASE_PG_URL = process.env.DECAF_PG_URL || DEFAULT_PG_URL;
const DATABASE_NAME = `decaf_rls_matrix_${process.pid}`;
const APP_ROLE = `rls_app_${process.pid}`;

function uuid(value: number): string {
  return `00000000-0000-4000-8000-${String(value).padStart(12, "0")}`;
}

function urlForDatabase(database: string): string {
  const url = new URL(BASE_PG_URL);
  url.pathname = `/${database}`;
  return url.toString();
}

function quoteIdentifier(identifier: string): string {
  return `"${identifier.replace(/"/g, '""')}"`;
}

const T1 = uuid(1);
const T2 = uuid(2);

const ROOT = uuid(10);
const DEPT = uuid(11);
const TEAM = uuid(12);
const SALES = uuid(13);
const ORG2 = uuid(14);

const U = {
  admin: uuid(20),
  adminOu: uuid(21),
  writer: uuid(22),
  writerOu: uuid(23),
  reader: uuid(24),
  readerOu: uuid(25),
  plain: uuid(26),
  other: uuid(27),
  t2Admin: uuid(28),
};

const P = {
  admin: uuid(120),
  adminOu: uuid(121),
  writer: uuid(122),
  writerOu: uuid(123),
  reader: uuid(124),
  readerOu: uuid(125),
  plain: uuid(126),
  other: uuid(127),
  t2Admin: uuid(128),
};

const PERM = {
  read: uuid(600),
  write: uuid(601),
  admin: uuid(602),
};

const ROLE = {
  admin: uuid(700),
  writer: uuid(701),
  reader: uuid(702),
  adminOu: uuid(703),
  global: uuid(704),
  t2: uuid(705),
};

const ROLE_PERMISSION = {
  admin: uuid(800),
  writer: uuid(801),
  reader: uuid(802),
  adminOu: uuid(803),
  global: uuid(804),
  t2: uuid(805),
};

const ROLE_ASSIGNMENT = {
  adminTenant: uuid(850),
  writerTenant: uuid(851),
  readerTenant: uuid(852),
  adminOu: uuid(853),
  writerOu: uuid(854),
  readerOu: uuid(855),
  adminResource: uuid(856),
  t2Admin: uuid(857),
};

const GROUP = {
  tenant: uuid(200),
  dept: uuid(201),
  team: uuid(202),
};

const PROJECT = {
  tenant: uuid(300),
  dept: uuid(301),
  team: uuid(302),
  privateOther: uuid(303),
  privatePlain: uuid(304),
  grantedToPlain: uuid(305),
  t2: uuid(306),
};

const CREDENTIAL = {
  plain: uuid(400),
  otherSales: uuid(401),
  tenant: uuid(402),
  dept: uuid(403),
  t2: uuid(404),
};

const SECRET = {
  plain: uuid(500),
  otherSales: uuid(501),
  tenant: uuid(502),
  dept: uuid(503),
  global: uuid(504),
  t2: uuid(505),
};

const ADMIN_ONLY_TABLES = [
  "permissions",
  "roles",
  "role_permissions",
  "role_assignments",
  "inheritance_blocks",
  "storage_bindings",
];

let adminClient: pg.Client;
let client: pg.Client;
let service: RlsBootstrapService;

async function insertRows(
  executor: pg.Client,
  table: string,
  columns: string[],
  rows: unknown[][]
): Promise<void> {
  const placeholders = rows
    .map(
      (_, rowIndex) =>
        `(${columns
          .map(
            (_, columnIndex) =>
              `$${rowIndex * columns.length + columnIndex + 1}`
          )
          .join(", ")})`
    )
    .join(", ");
  await executor.query(
    `INSERT INTO ${table} (${columns.join(", ")}) VALUES ${placeholders}`,
    rows.flat()
  );
}

async function insertRow(
  executor: pg.Client,
  table: string,
  row: Record<string, unknown>
): Promise<void> {
  const columns = Object.keys(row);
  await insertRows(executor, table, columns, [
    columns.map((column) => row[column]),
  ]);
}

async function seed(): Promise<void> {
  await insertRows(client, "tenants", ["id", "slug", "name"], [
    [T1, "tenant-one", "Tenant One"],
    [T2, "tenant-two", "Tenant Two"],
  ]);

  await insertRows(
    client,
    "org_units",
    ["id", "tenant_id", "parent_id", "name", "path"],
    [
      [ROOT, T1, null, "root", "/root"],
      [DEPT, T1, ROOT, "department", "/root/department"],
      [TEAM, T1, DEPT, "team", "/root/department/team"],
      [SALES, T1, ROOT, "sales", "/root/sales"],
      [ORG2, T2, null, "tenant-two-root", "/root"],
    ]
  );

  await insertRows(
    client,
    "org_unit_closure",
    [
      "id",
      "tenant_id",
      "ancestor_org_unit_id",
      "descendant_org_unit_id",
      "depth",
    ],
    [
      [uuid(980), T1, ROOT, ROOT, 0],
      [uuid(981), T1, DEPT, DEPT, 0],
      [uuid(982), T1, TEAM, TEAM, 0],
      [uuid(983), T1, SALES, SALES, 0],
      [uuid(984), T1, ROOT, DEPT, 1],
      [uuid(985), T1, ROOT, TEAM, 2],
      [uuid(986), T1, DEPT, TEAM, 1],
      [uuid(987), T2, ORG2, ORG2, 0],
    ]
  );

  await insertRows(
    client,
    "users",
    ["id", "email", "display_name"],
    [
      [U.admin, "admin@example.test", "Admin"],
      [U.adminOu, "admin-ou@example.test", "Org Unit Admin"],
      [U.writer, "writer@example.test", "Writer"],
      [U.writerOu, "writer-ou@example.test", "Org Unit Writer"],
      [U.reader, "reader@example.test", "Reader"],
      [U.readerOu, "reader-ou@example.test", "Org Unit Reader"],
      [U.plain, "plain@example.test", "Plain Member"],
      [U.other, "other@example.test", "Other Member"],
      [U.t2Admin, "t2-admin@example.test", "Tenant Two Admin"],
    ]
  );

  await insertRows(
    client,
    "principals",
    ["id", "tenant_id", "kind", "subject_id"],
    [
      [P.admin, T1, "user", U.admin],
      [P.adminOu, T1, "user", U.adminOu],
      [P.writer, T1, "user", U.writer],
      [P.writerOu, T1, "user", U.writerOu],
      [P.reader, T1, "user", U.reader],
      [P.readerOu, T1, "user", U.readerOu],
      [P.plain, T1, "user", U.plain],
      [P.other, T1, "user", U.other],
      [P.t2Admin, T2, "user", U.t2Admin],
    ]
  );

  await insertRows(
    client,
    "tenant_memberships",
    ["id", "tenant_id", "user_id", "status"],
    [
      [uuid(960), T1, U.admin, "active"],
      [uuid(961), T1, U.adminOu, "active"],
      [uuid(962), T1, U.writer, "active"],
      [uuid(963), T1, U.writerOu, "active"],
      [uuid(964), T1, U.reader, "active"],
      [uuid(965), T1, U.readerOu, "active"],
      [uuid(966), T1, U.plain, "active"],
      [uuid(967), T1, U.other, "active"],
      [uuid(968), T2, U.t2Admin, "active"],
    ]
  );

  await insertRows(
    client,
    "org_unit_memberships",
    ["id", "tenant_id", "org_unit_id", "user_id", "status"],
    [
      [uuid(970), T1, DEPT, U.plain, "active"],
      [uuid(971), T1, TEAM, U.plain, "active"],
      [uuid(972), T1, TEAM, U.other, "active"],
      [uuid(973), T1, DEPT, U.readerOu, "active"],
      [uuid(974), T1, DEPT, U.writerOu, "active"],
      [uuid(975), T1, DEPT, U.adminOu, "active"],
    ]
  );

  await insertRows(
    client,
    "groups",
    ["id", "tenant_id", "org_unit_id", "name"],
    [
      [GROUP.tenant, T1, null, "tenant-group"],
      [GROUP.dept, T1, DEPT, "dept-group"],
      [GROUP.team, T1, TEAM, "team-group"],
    ]
  );

  await insertRows(
    client,
    "group_memberships",
    ["id", "tenant_id", "group_id", "principal_id"],
    [
      [uuid(950), T1, GROUP.team, P.plain],
      [uuid(951), T1, GROUP.team, P.other],
    ]
  );

  await insertRows(
    client,
    "permissions",
    ["id", "key", "category"],
    [
      [PERM.read, RLS_PERMISSION_KEYS.Read, "namespace"],
      [PERM.write, RLS_PERMISSION_KEYS.Write, "namespace"],
      [PERM.admin, RLS_PERMISSION_KEYS.Admin, "namespace"],
    ]
  );

  await insertRows(
    client,
    "roles",
    ["id", "tenant_id", "key", "name"],
    [
      [ROLE.admin, T1, RLS_ROLE_KEYS.Admin, "Tenant Admin"],
      [ROLE.writer, T1, RLS_ROLE_KEYS.Writer, "Tenant Writer"],
      [ROLE.reader, T1, RLS_ROLE_KEYS.Reader, "Tenant Reader"],
      [ROLE.adminOu, T1, RLS_ROLE_KEYS.Admin, "Department Admin"],
      [ROLE.global, null, RLS_ROLE_KEYS.Admin, "Global Admin"],
      [ROLE.t2, T2, RLS_ROLE_KEYS.Admin, "Tenant Two Admin"],
    ]
  );

  await insertRows(
    client,
    "role_permissions",
    ["id", "role_id", "permission_id"],
    [
      [ROLE_PERMISSION.admin, ROLE.admin, PERM.admin],
      [ROLE_PERMISSION.writer, ROLE.writer, PERM.write],
      [ROLE_PERMISSION.reader, ROLE.reader, PERM.read],
      [ROLE_PERMISSION.adminOu, ROLE.adminOu, PERM.admin],
      [ROLE_PERMISSION.global, ROLE.global, PERM.admin],
      [ROLE_PERMISSION.t2, ROLE.t2, PERM.admin],
    ]
  );

  await insertRows(
    client,
    "role_assignments",
    [
      "id",
      "tenant_id",
      "principal_id",
      "role_id",
      "scope_kind",
      "scope_id",
      "inherit_down",
    ],
    [
      [ROLE_ASSIGNMENT.adminTenant, T1, P.admin, ROLE.admin, "tenant", T1, true],
      [ROLE_ASSIGNMENT.writerTenant, T1, P.writer, ROLE.writer, "tenant", T1, true],
      [ROLE_ASSIGNMENT.readerTenant, T1, P.reader, ROLE.reader, "tenant", T1, true],
      [ROLE_ASSIGNMENT.adminOu, T1, P.adminOu, ROLE.adminOu, "org_unit", DEPT, true],
      [ROLE_ASSIGNMENT.writerOu, T1, P.writerOu, ROLE.writer, "org_unit", DEPT, true],
      [ROLE_ASSIGNMENT.readerOu, T1, P.readerOu, ROLE.reader, "org_unit", DEPT, true],
      [ROLE_ASSIGNMENT.adminResource, T1, P.adminOu, ROLE.adminOu, "resource", PROJECT.dept, false],
      [ROLE_ASSIGNMENT.t2Admin, T2, P.t2Admin, ROLE.t2, "tenant", T2, false],
    ]
  );

  await insertRows(
    client,
    "effective_permissions",
    [
      "id",
      "tenant_id",
      "principal_id",
      "permission_key",
      "scope_kind",
      "scope_id",
      "source_kind",
      "source_id",
    ],
    [
      [uuid(880), T1, P.admin, RLS_PERMISSION_KEYS.Admin, "tenant", T1, "role_assignment", ROLE_ASSIGNMENT.adminTenant],
      [uuid(881), T1, P.writer, RLS_PERMISSION_KEYS.Write, "tenant", T1, "role_assignment", ROLE_ASSIGNMENT.writerTenant],
      [uuid(882), T1, P.reader, RLS_PERMISSION_KEYS.Read, "tenant", T1, "role_assignment", ROLE_ASSIGNMENT.readerTenant],
      [uuid(883), T1, P.adminOu, RLS_PERMISSION_KEYS.Admin, "org_unit", DEPT, "role_assignment", ROLE_ASSIGNMENT.adminOu],
      [uuid(884), T1, P.writerOu, RLS_PERMISSION_KEYS.Write, "org_unit", DEPT, "role_assignment", ROLE_ASSIGNMENT.writerOu],
      [uuid(885), T1, P.readerOu, RLS_PERMISSION_KEYS.Read, "org_unit", DEPT, "role_assignment", ROLE_ASSIGNMENT.readerOu],
      [uuid(886), T2, P.t2Admin, RLS_PERMISSION_KEYS.Admin, "tenant", T2, "role_assignment", ROLE_ASSIGNMENT.t2Admin],
    ]
  );

  await insertRows(
    client,
    "protected_resources",
    [
      "id",
      "tenant_id",
      "org_unit_id",
      "resource_type",
      "resource_id",
      "visibility",
      "owner_principal_id",
    ],
    [
      [PROJECT.tenant, T1, ROOT, "project", "p-tenant", "tenant", P.admin],
      [PROJECT.dept, T1, DEPT, "project", "p-dept", "org_unit", P.admin],
      [PROJECT.team, T1, TEAM, "project", "p-team", "org_unit", P.other],
      [PROJECT.privateOther, T1, TEAM, "project", "p-private-other", "private", P.other],
      [PROJECT.privatePlain, T1, TEAM, "project", "p-private-plain", "private", P.plain],
      [PROJECT.grantedToPlain, T1, TEAM, "project", "p-grant", "private", P.other],
      [PROJECT.t2, T2, ORG2, "project", "p-t2", "tenant", P.t2Admin],
    ]
  );

  await insertRows(
    client,
    "resource_grants",
    [
      "id",
      "tenant_id",
      "resource_id",
      "principal_id",
      "permission_key",
      "created_by_principal_id",
    ],
    [
      [uuid(900), T1, PROJECT.grantedToPlain, P.plain, "resource.read", P.admin],
    ]
  );

  await insertRows(
    client,
    "credentials",
    [
      "id",
      "tenant_id",
      "org_unit_id",
      "owner_principal_id",
      "name",
      "credential_type",
      "secret_name",
      "provider",
    ],
    [
      [CREDENTIAL.plain, T1, TEAM, P.plain, "plain-credential", "password", "plain-secret", "model"],
      [CREDENTIAL.otherSales, T1, SALES, P.other, "other-sales-credential", "password", "other-sales-secret", "model"],
      [CREDENTIAL.tenant, T1, null, P.admin, "tenant-credential", "password", "tenant-secret", "model"],
      [CREDENTIAL.dept, T1, DEPT, P.admin, "dept-credential", "password", "dept-secret", "model"],
      [CREDENTIAL.t2, T2, ORG2, P.t2Admin, "t2-credential", "password", "t2-secret", "model"],
    ]
  );

  await insertRows(
    client,
    "secrets",
    [
      "id",
      "name",
      "provider",
      "encrypted_payload",
      "encryption",
      "tenant_id",
      "org_unit_id",
      "owner_principal_id",
    ],
    [
      [SECRET.plain, "plain-secret", "model", "encrypted", '{"keyId":"k1"}', T1, TEAM, P.plain],
      [SECRET.otherSales, "other-sales-secret", "model", "encrypted", '{"keyId":"k1"}', T1, SALES, P.other],
      [SECRET.tenant, "tenant-secret", "model", "encrypted", '{"keyId":"k1"}', T1, null, P.admin],
      [SECRET.dept, "dept-secret", "model", "encrypted", '{"keyId":"k1"}', T1, DEPT, P.admin],
      [SECRET.global, "global-secret", "model", "encrypted", '{"keyId":"k1"}', null, null, null],
      [SECRET.t2, "t2-secret", "model", "encrypted", '{"keyId":"k1"}', T2, ORG2, P.t2Admin],
    ]
  );

  await insertRows(
    client,
    "storage_bindings",
    [
      "id",
      "tenant_id",
      "storage_kind",
      "binding_kind",
      "binding_key",
      "region",
    ],
    [[uuid(990), T1, "s3", "bucket", "tenant-one-bucket", "eu-west-1"]]
  );

  await insertRows(
    client,
    "tenant_profiles",
    ["id", "tenant_id", "profile_key"],
    [[uuid(991), T1, "default"]]
  );

  await insertRows(
    client,
    "org_unit_profiles",
    ["id", "org_unit_id", "profile_key"],
    [[uuid(992), DEPT, "default"]]
  );

  await insertRows(
    client,
    "inheritance_blocks",
    [
      "id",
      "tenant_id",
      "org_unit_id",
      "blocked_from_ancestor_id",
      "permission_category",
    ],
    [[uuid(993), T1, DEPT, null, "namespace"]]
  );
}

async function withPrincipal<T>(
  principalId: string,
  run: () => Promise<T>
): Promise<T> {
  await client.query("BEGIN");
  try {
    await service.setPrincipal(principalId);
    const result = await run();
    await client.query("ROLLBACK");
    return result;
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch {
      // keep the original failure
    }
    throw error;
  }
}

async function rowsAs(
  principalId: string,
  sql: string,
  values: unknown[] = []
): Promise<Record<string, any>[]> {
  return withPrincipal(principalId, async () => {
    const result = await client.query(sql, values);
    return result.rows as Record<string, any>[];
  });
}

async function idsAs(
  principalId: string,
  sql: string,
  values: unknown[] = []
): Promise<string[]> {
  const rows = await rowsAs(principalId, sql, values);
  return rows.map((row) => row.id as string);
}

async function insertDeniedAs(
  principalId: string,
  table: string,
  row: Record<string, unknown>
): Promise<void> {
  await withPrincipal(principalId, async () => {
    await client.query("SAVEPOINT denied_insert");
    try {
      await insertRow(client, table, row);
      throw new Error(`Expected RLS to deny INSERT into ${table}`);
    } catch (error) {
      const message = (error as Error).message;
      if (message.startsWith("Expected RLS to deny INSERT")) {
        throw error;
      }
      expect(message).toMatch(/row-level security/i);
      await client.query("ROLLBACK TO SAVEPOINT denied_insert");
    }
  });
}

async function updateCountAs(
  principalId: string,
  table: string,
  id: string,
  column: string,
  value: unknown
): Promise<number | null> {
  return withPrincipal(principalId, async () => {
    const result = await client.query(
      `UPDATE ${table} SET ${column} = $1 WHERE id = $2`,
      [value, id]
    );
    return result.rowCount;
  });
}

async function deleteCountAs(
  principalId: string,
  table: string,
  id: string
): Promise<number | null> {
  return withPrincipal(principalId, async () => {
    const result = await client.query(`DELETE FROM ${table} WHERE id = $1`, [
      id,
    ]);
    return result.rowCount;
  });
}

async function expectNoAdminTables(principalId: string): Promise<void> {
  for (const table of ADMIN_ONLY_TABLES) {
    const rows = await rowsAs(principalId, `SELECT * FROM ${table}`);
    expect({ table, count: rows.length }).toEqual({ table, count: 0 });
  }
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
  await adminClient.query(
    `CREATE DATABASE ${quoteIdentifier(DATABASE_NAME)}`
  );

  client = new pg.Client({
    connectionString: urlForDatabase(DATABASE_NAME),
    connectionTimeoutMillis: 5_000,
  });
  await client.connect();
  await client.query(readFileSync(fixturePath, "utf8"));

  service = new RlsBootstrapService();
  await service.boot(client);
  const applied = await service.apply();
  expect(applied.applied).toBe(rlsBootstrapStatements().length);

  await seed();

  await client.query(
    `CREATE ROLE ${quoteIdentifier(APP_ROLE)} NOSUPERUSER NOBYPASSRLS`
  );
  await client.query(
    `GRANT USAGE ON SCHEMA public TO ${quoteIdentifier(APP_ROLE)}`
  );
  await client.query(
    `GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ${quoteIdentifier(APP_ROLE)}`
  );
  await client.query(`SET ROLE ${quoteIdentifier(APP_ROLE)}`);

  const identity = await client.query(
    `SELECT current_user, session_user,
            (SELECT rolbypassrls FROM pg_roles WHERE rolname = current_user) AS rolbypassrls`
  );
  expect(identity.rows[0]).toMatchObject({
    current_user: APP_ROLE,
    session_user: "decaf",
    rolbypassrls: false,
  });
});

afterAll(async () => {
  if (client) {
    try {
      await client.query("RESET ROLE");
      await client.query(
        `DROP OWNED BY ${quoteIdentifier(APP_ROLE)}`
      );
    } catch {
      // database teardown below still removes the role's grants
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
      await adminClient.query(
        `DROP ROLE IF EXISTS ${quoteIdentifier(APP_ROLE)}`
      );
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

describe("RLS bootstrap in Postgres", () => {
  it("resolves and applies the bundled template through the service", () => {
    expect(service.statements()).toEqual(rlsBootstrapStatements());
  });

  it("binds the acting principal through the service setting", async () => {
    await withPrincipal(P.reader, async () => {
      const bound = await client.query(
        "SELECT current_setting('app.principal_id', true) AS setting, app_rls_principal_id() AS principal"
      );
      expect(bound.rows[0]).toEqual({
        setting: P.reader,
        principal: P.reader,
      });
      await expect(service.currentPrincipal()).resolves.toBe(P.reader);
    });
  });
});

describe("tenant-scoped reader", () => {
  it("reads tenant content but not other tenants", async () => {
    expect(await idsAs(P.reader, "SELECT id FROM tenants")).toEqual([T1]);
    expect(
      new Set(await idsAs(P.reader, "SELECT id FROM org_units"))
    ).toEqual(new Set([ROOT, DEPT, TEAM, SALES]));
    expect(
      new Set(await idsAs(P.reader, "SELECT id FROM groups"))
    ).toEqual(new Set([GROUP.tenant, GROUP.dept, GROUP.team]));
    expect(
      new Set(await idsAs(P.reader, "SELECT id FROM protected_resources"))
    ).toEqual(new Set([PROJECT.tenant, PROJECT.dept, PROJECT.team]));
  });

  it("sees its own identity and effective permissions only", async () => {
    expect(await idsAs(P.reader, "SELECT id FROM users")).toEqual([U.reader]);
    expect(await idsAs(P.reader, "SELECT id FROM principals")).toEqual([
      P.reader,
    ]);
    expect(
      await idsAs(P.reader, "SELECT id FROM effective_permissions")
    ).toEqual([uuid(882)]);
  });

  it("reads credentials and secrets in tenant scope", async () => {
    expect(
      new Set(await idsAs(P.reader, "SELECT id FROM credentials"))
    ).toEqual(
      new Set([
        CREDENTIAL.plain,
        CREDENTIAL.otherSales,
        CREDENTIAL.tenant,
        CREDENTIAL.dept,
      ])
    );
    expect(
      new Set(await idsAs(P.reader, "SELECT id FROM secrets"))
    ).toEqual(
      new Set([SECRET.plain, SECRET.otherSales, SECRET.tenant, SECRET.dept])
    );
    expect(
      await idsAs(P.reader, "SELECT id FROM secrets WHERE id = $1", [
        SECRET.global,
      ])
    ).toEqual([]);
  });

  it("cannot read the administrative machinery", async () => {
    await expectNoAdminTables(P.reader);
  });

  it("cannot create content in the namespace", async () => {
    await insertDeniedAs(P.reader, "org_units", {
      id: uuid(1100),
      tenant_id: T1,
      parent_id: DEPT,
      name: "reader-org",
      path: "/root/department/reader-org",
    });
    await insertDeniedAs(P.reader, "groups", {
      id: uuid(1101),
      tenant_id: T1,
      org_unit_id: TEAM,
      name: "reader-group",
    });
    await insertDeniedAs(P.reader, "protected_resources", {
      id: uuid(1102),
      tenant_id: T1,
      org_unit_id: TEAM,
      resource_type: "project",
      resource_id: "reader-project",
      visibility: "private",
      owner_principal_id: P.reader,
    });
    await insertDeniedAs(P.reader, "resource_grants", {
      id: uuid(1103),
      tenant_id: T1,
      resource_id: PROJECT.team,
      principal_id: P.reader,
      permission_key: "resource.read",
    });
    await insertDeniedAs(P.reader, "credentials", {
      id: uuid(1104),
      tenant_id: T1,
      org_unit_id: TEAM,
      owner_principal_id: P.reader,
      name: "reader-credential",
      credential_type: "password",
      secret_name: "reader-secret",
      provider: "model",
    });
    await insertDeniedAs(P.reader, "secrets", {
      id: uuid(1105),
      name: "reader-secret",
      provider: "model",
      encrypted_payload: "encrypted",
      encryption: '{"keyId":"k1"}',
      tenant_id: T1,
      org_unit_id: TEAM,
      owner_principal_id: P.reader,
    });
    await insertDeniedAs(P.reader, "roles", {
      id: uuid(1106),
      tenant_id: T1,
      key: "reader-created-role",
      name: "Reader Created Role",
    });
  });

  it("cannot update or delete content", async () => {
    expect(
      await updateCountAs(P.reader, "org_units", DEPT, "name", "changed")
    ).toBe(0);
    expect(
      await updateCountAs(P.reader, "groups", GROUP.dept, "name", "changed")
    ).toBe(0);
    expect(
      await updateCountAs(
        P.reader,
        "protected_resources",
        PROJECT.dept,
        "sensitivity",
        "high"
      )
    ).toBe(0);
    expect(
      await updateCountAs(
        P.reader,
        "resource_grants",
        uuid(900),
        "permission_key",
        "resource.write"
      )
    ).toBe(0);
    expect(
      await updateCountAs(
        P.reader,
        "credentials",
        CREDENTIAL.tenant,
        "name",
        "changed"
      )
    ).toBe(0);
    expect(
      await updateCountAs(P.reader, "secrets", SECRET.tenant, "name", "changed")
    ).toBe(0);
    expect(
      await updateCountAs(P.reader, "roles", ROLE.reader, "name", "changed")
    ).toBe(0);

    expect(await deleteCountAs(P.reader, "org_units", DEPT)).toBe(0);
    expect(await deleteCountAs(P.reader, "groups", GROUP.dept)).toBe(0);
    expect(
      await deleteCountAs(P.reader, "protected_resources", PROJECT.dept)
    ).toBe(0);
    expect(await deleteCountAs(P.reader, "credentials", CREDENTIAL.tenant)).toBe(
      0
    );
    expect(await deleteCountAs(P.reader, "secrets", SECRET.tenant)).toBe(0);
    expect(await deleteCountAs(P.reader, "roles", ROLE.reader)).toBe(0);
  });
});

describe("org-unit-scoped reader", () => {
  it("reads the department scope and scoped credentials", async () => {
    expect(await idsAs(P.readerOu, "SELECT id FROM org_units")).toEqual([DEPT]);
    expect(await idsAs(P.readerOu, "SELECT id FROM groups")).toEqual([
      GROUP.dept,
    ]);
    expect(
      await idsAs(P.readerOu, "SELECT id FROM protected_resources")
    ).toEqual([PROJECT.dept]);
    expect(await idsAs(P.readerOu, "SELECT id FROM credentials")).toEqual([
      CREDENTIAL.dept,
    ]);
  });

  it("cannot read or write administrative machinery", async () => {
    await expectNoAdminTables(P.readerOu);
    expect(
      await updateCountAs(P.readerOu, "roles", ROLE.reader, "name", "changed")
    ).toBe(0);
    expect(await deleteCountAs(P.readerOu, "role_permissions", ROLE_PERMISSION.reader)).toBe(0);
  });
});

describe("tenant-scoped writer", () => {
  it("reads content but not the administrative machinery", async () => {
    expect(
      new Set(await idsAs(P.writer, "SELECT id FROM protected_resources"))
    ).toEqual(new Set([PROJECT.tenant, PROJECT.dept, PROJECT.team]));
    expect(
      await idsAs(P.writer, "SELECT id FROM protected_resources WHERE id = $1", [
        PROJECT.privateOther,
      ])
    ).toEqual([]);
    expect(
      await idsAs(P.writer, "SELECT id FROM effective_permissions")
    ).toEqual([uuid(881)]);
    await expectNoAdminTables(P.writer);
  });

  it("creates and removes non-admin content in tenant scope", async () => {
    await withPrincipal(P.writer, async () => {
      const orgUnitId = uuid(1110);
      await insertRow(client, "org_units", {
        id: orgUnitId,
        tenant_id: T1,
        parent_id: DEPT,
        name: "writer-org",
        path: "/root/department/writer-org",
      });
      expect(
        (
          await client.query("UPDATE org_units SET name = $1 WHERE id = $2", [
            "writer-org-updated",
            orgUnitId,
          ])
        ).rowCount
      ).toBe(1);
      expect(
        (
          await client.query("DELETE FROM org_units WHERE id = $1", [orgUnitId])
        ).rowCount
      ).toBe(1);

      const groupId = uuid(1111);
      await insertRow(client, "groups", {
        id: groupId,
        tenant_id: T1,
        org_unit_id: TEAM,
        name: "writer-group",
      });
      expect(
        (
          await client.query("DELETE FROM groups WHERE id = $1", [groupId])
        ).rowCount
      ).toBe(1);

      const projectId = uuid(1112);
      await insertRow(client, "protected_resources", {
        id: projectId,
        tenant_id: T1,
        org_unit_id: TEAM,
        resource_type: "project",
        resource_id: "writer-project",
        visibility: "private",
        owner_principal_id: P.writer,
      });
      expect(
        (
          await client.query(
            "DELETE FROM protected_resources WHERE id = $1",
            [projectId]
          )
        ).rowCount
      ).toBe(1);

      const grantId = uuid(1113);
      await insertRow(client, "resource_grants", {
        id: grantId,
        tenant_id: T1,
        resource_id: PROJECT.dept,
        principal_id: P.reader,
        permission_key: "resource.read",
      });
      expect(
        (
          await client.query("DELETE FROM resource_grants WHERE id = $1", [
            grantId,
          ])
        ).rowCount
      ).toBe(1);

      const credentialId = uuid(1114);
      await insertRow(client, "credentials", {
        id: credentialId,
        tenant_id: T1,
        org_unit_id: TEAM,
        owner_principal_id: P.writer,
        name: "writer-credential",
        credential_type: "password",
        secret_name: "writer-secret",
        provider: "model",
      });
      expect(
        (
          await client.query("UPDATE credentials SET name = $1 WHERE id = $2", [
            "writer-credential-updated",
            credentialId,
          ])
        ).rowCount
      ).toBe(1);
      expect(
        (
          await client.query("DELETE FROM credentials WHERE id = $1", [
            credentialId,
          ])
        ).rowCount
      ).toBe(1);

      const secretId = uuid(1115);
      await insertRow(client, "secrets", {
        id: secretId,
        name: "writer-secret",
        provider: "model",
        encrypted_payload: "encrypted",
        encryption: '{"keyId":"k1"}',
        tenant_id: T1,
        org_unit_id: TEAM,
        owner_principal_id: P.writer,
      });
      expect(
        (
          await client.query("DELETE FROM secrets WHERE id = $1", [secretId])
        ).rowCount
      ).toBe(1);
    });
  });

  it("cannot write the administrative machinery", async () => {
    await insertDeniedAs(P.writer, "permissions", {
      id: uuid(1120),
      key: "writer.created",
      category: "namespace",
    });
    await insertDeniedAs(P.writer, "roles", {
      id: uuid(1121),
      tenant_id: T1,
      key: "writer-created-role",
      name: "Writer Created Role",
    });
    await insertDeniedAs(P.writer, "role_permissions", {
      id: uuid(1122),
      role_id: ROLE.reader,
      permission_id: PERM.read,
    });
    await insertDeniedAs(P.writer, "role_assignments", {
      id: uuid(1123),
      tenant_id: T1,
      principal_id: P.writer,
      role_id: ROLE.writer,
      scope_kind: "tenant",
      scope_id: T1,
    });
    await insertDeniedAs(P.writer, "inheritance_blocks", {
      id: uuid(1124),
      tenant_id: T1,
      org_unit_id: DEPT,
      permission_category: "namespace",
    });
    await insertDeniedAs(P.writer, "storage_bindings", {
      id: uuid(1125),
      tenant_id: T1,
      storage_kind: "s3",
      binding_kind: "bucket",
      binding_key: "writer-bucket",
      region: "eu-west-1",
    });

    expect(
      await updateCountAs(P.writer, "roles", ROLE.reader, "name", "changed")
    ).toBe(0);
    expect(
      await deleteCountAs(P.writer, "role_assignments", ROLE_ASSIGNMENT.readerTenant)
    ).toBe(0);
    expect(await deleteCountAs(P.writer, "permissions", PERM.read)).toBe(0);
  });
});

describe("org-unit-scoped writer", () => {
  it("writes non-admin content inside the department", async () => {
    await withPrincipal(P.writerOu, async () => {
      const orgUnitId = uuid(1130);
      await insertRow(client, "org_units", {
        id: orgUnitId,
        tenant_id: T1,
        parent_id: DEPT,
        name: "writer-ou-org",
        path: "/root/department/writer-ou-org",
      });
      expect(
        (
          await client.query("UPDATE org_units SET name = $1 WHERE id = $2", [
            "department-updated",
            DEPT,
          ])
        ).rowCount
      ).toBe(1);

      const groupId = uuid(1131);
      await insertRow(client, "groups", {
        id: groupId,
        tenant_id: T1,
        org_unit_id: DEPT,
        name: "writer-ou-group",
      });
      expect(
        (
          await client.query("DELETE FROM groups WHERE id = $1", [groupId])
        ).rowCount
      ).toBe(1);

      const projectId = uuid(1132);
      await insertRow(client, "protected_resources", {
        id: projectId,
        tenant_id: T1,
        org_unit_id: DEPT,
        resource_type: "project",
        resource_id: "writer-ou-project",
        visibility: "private",
        owner_principal_id: P.writerOu,
      });
      expect(
        (
          await client.query("DELETE FROM protected_resources WHERE id = $1", [
            projectId,
          ])
        ).rowCount
      ).toBe(1);

      const credentialId = uuid(1133);
      await insertRow(client, "credentials", {
        id: credentialId,
        tenant_id: T1,
        org_unit_id: DEPT,
        owner_principal_id: P.writerOu,
        name: "writer-ou-credential",
        credential_type: "password",
        secret_name: "writer-ou-secret",
        provider: "model",
      });
      expect(
        (
          await client.query("DELETE FROM credentials WHERE id = $1", [
            credentialId,
          ])
        ).rowCount
      ).toBe(1);

      const secretId = uuid(1134);
      await insertRow(client, "secrets", {
        id: secretId,
        name: "writer-ou-secret",
        provider: "model",
        encrypted_payload: "encrypted",
        encryption: '{"keyId":"k1"}',
        tenant_id: T1,
        org_unit_id: DEPT,
        owner_principal_id: P.writerOu,
      });
      expect(
        (
          await client.query("DELETE FROM secrets WHERE id = $1", [secretId])
        ).rowCount
      ).toBe(1);

      expect(
        (
          await client.query("DELETE FROM org_units WHERE id = $1", [DEPT])
        ).rowCount
      ).toBe(1);
    });
  });

  it("cannot write outside the department", async () => {
    await insertDeniedAs(P.writerOu, "org_units", {
      id: uuid(1140),
      tenant_id: T1,
      parent_id: ROOT,
      name: "writer-ou-root-org",
      path: "/root/writer-ou-root-org",
    });
    await insertDeniedAs(P.writerOu, "groups", {
      id: uuid(1141),
      tenant_id: T1,
      org_unit_id: TEAM,
      name: "writer-ou-team-group",
    });
    await insertDeniedAs(P.writerOu, "protected_resources", {
      id: uuid(1142),
      tenant_id: T1,
      org_unit_id: TEAM,
      resource_type: "project",
      resource_id: "writer-ou-team-project",
      visibility: "private",
      owner_principal_id: P.writerOu,
    });
    await insertDeniedAs(P.writerOu, "credentials", {
      id: uuid(1143),
      tenant_id: T1,
      org_unit_id: TEAM,
      owner_principal_id: P.writerOu,
      name: "writer-ou-team-credential",
      credential_type: "password",
      secret_name: "writer-ou-team-secret",
      provider: "model",
    });
    await insertDeniedAs(P.writerOu, "secrets", {
      id: uuid(1144),
      name: "writer-ou-team-secret",
      provider: "model",
      encrypted_payload: "encrypted",
      encryption: '{"keyId":"k1"}',
      tenant_id: T1,
      org_unit_id: TEAM,
      owner_principal_id: P.writerOu,
    });
  });
});

describe("tenant-scoped admin", () => {
  it("reads all administrative machinery", async () => {
    expect(
      new Set(await idsAs(P.admin, "SELECT id FROM permissions"))
    ).toEqual(new Set([PERM.read, PERM.write, PERM.admin]));
    expect(new Set(await idsAs(P.admin, "SELECT id FROM roles"))).toEqual(
      new Set([
        ROLE.admin,
        ROLE.writer,
        ROLE.reader,
        ROLE.adminOu,
        ROLE.global,
      ])
    );
    expect(
      new Set(await idsAs(P.admin, "SELECT id FROM role_permissions"))
    ).toEqual(
      new Set([
        ROLE_PERMISSION.admin,
        ROLE_PERMISSION.writer,
        ROLE_PERMISSION.reader,
        ROLE_PERMISSION.adminOu,
        ROLE_PERMISSION.global,
      ])
    );
    expect(
      new Set(await idsAs(P.admin, "SELECT id FROM role_assignments"))
    ).toEqual(
      new Set([
        ROLE_ASSIGNMENT.adminTenant,
        ROLE_ASSIGNMENT.writerTenant,
        ROLE_ASSIGNMENT.readerTenant,
        ROLE_ASSIGNMENT.adminOu,
        ROLE_ASSIGNMENT.writerOu,
        ROLE_ASSIGNMENT.readerOu,
        ROLE_ASSIGNMENT.adminResource,
      ])
    );
    expect(
      await idsAs(P.admin, "SELECT id FROM inheritance_blocks")
    ).toEqual([uuid(993)]);
    expect(
      await idsAs(P.admin, "SELECT id FROM storage_bindings")
    ).toEqual([uuid(990)]);
  });

  it("reads all tenant content, users, and effectively global secrets", async () => {
    expect(
      new Set(await idsAs(P.admin, "SELECT id FROM users"))
    ).toEqual(
      new Set([
        U.admin,
        U.adminOu,
        U.writer,
        U.writerOu,
        U.reader,
        U.readerOu,
        U.plain,
        U.other,
      ])
    );
    expect(
      new Set(await idsAs(P.admin, "SELECT id FROM protected_resources"))
    ).toEqual(
      new Set([
        PROJECT.tenant,
        PROJECT.dept,
        PROJECT.team,
        PROJECT.privateOther,
        PROJECT.privatePlain,
        PROJECT.grantedToPlain,
      ])
    );
    expect(
      new Set(await idsAs(P.admin, "SELECT id FROM credentials"))
    ).toEqual(
      new Set([
        CREDENTIAL.plain,
        CREDENTIAL.otherSales,
        CREDENTIAL.tenant,
        CREDENTIAL.dept,
      ])
    );
    expect(
      new Set(await idsAs(P.admin, "SELECT id FROM secrets"))
    ).toEqual(
      new Set([
        SECRET.plain,
        SECRET.otherSales,
        SECRET.tenant,
        SECRET.dept,
        SECRET.global,
      ])
    );
  });

  it("does not leak another tenant's rows", async () => {
    expect(await idsAs(P.admin, "SELECT id FROM tenants")).toEqual([T1]);
    expect(
      await idsAs(P.admin, "SELECT id FROM users WHERE id = $1", [U.t2Admin])
    ).toEqual([]);
    expect(
      await idsAs(P.admin, "SELECT id FROM protected_resources WHERE id = $1", [
        PROJECT.t2,
      ])
    ).toEqual([]);
    expect(
      await idsAs(P.admin, "SELECT id FROM roles WHERE id = $1", [ROLE.t2])
    ).toEqual([]);
    expect(
      await idsAs(P.admin, "SELECT id FROM credentials WHERE id = $1", [
        CREDENTIAL.t2,
      ])
    ).toEqual([]);
    expect(
      await idsAs(P.admin, "SELECT id FROM secrets WHERE id = $1", [SECRET.t2])
    ).toEqual([]);
  });

  it("writes administrative machinery and content", async () => {
    await withPrincipal(P.admin, async () => {
      const permissionId = uuid(1150);
      await insertRow(client, "permissions", {
        id: permissionId,
        key: "namespace.admin.test",
        category: "namespace",
      });
      expect(
        (
          await client.query("DELETE FROM permissions WHERE id = $1", [
            permissionId,
          ])
        ).rowCount
      ).toBe(1);

      const roleId = uuid(1151);
      await insertRow(client, "roles", {
        id: roleId,
        tenant_id: T1,
        key: "admin-created-role",
        name: "Admin Created Role",
      });
      expect(
        (
          await client.query("UPDATE roles SET name = $1 WHERE id = $2", [
            "Admin Created Role Updated",
            roleId,
          ])
        ).rowCount
      ).toBe(1);

      const rolePermissionId = uuid(1152);
      await insertRow(client, "role_permissions", {
        id: rolePermissionId,
        role_id: roleId,
        permission_id: PERM.admin,
      });
      expect(
        (
          await client.query("DELETE FROM role_permissions WHERE id = $1", [
            rolePermissionId,
          ])
        ).rowCount
      ).toBe(1);

      const tenantAssignmentId = uuid(1153);
      await insertRow(client, "role_assignments", {
        id: tenantAssignmentId,
        tenant_id: T1,
        principal_id: P.writer,
        role_id: roleId,
        scope_kind: "tenant",
        scope_id: T1,
      });
      const resourceAssignmentId = uuid(1154);
      await insertRow(client, "role_assignments", {
        id: resourceAssignmentId,
        tenant_id: T1,
        principal_id: P.adminOu,
        role_id: roleId,
        scope_kind: "resource",
        scope_id: PROJECT.dept,
      });
      expect(
        (
          await client.query("DELETE FROM role_assignments WHERE id = ANY($1)", [
            [tenantAssignmentId, resourceAssignmentId],
          ])
        ).rowCount
      ).toBe(2);

      const inheritanceBlockId = uuid(1155);
      await insertRow(client, "inheritance_blocks", {
        id: inheritanceBlockId,
        tenant_id: T1,
        org_unit_id: DEPT,
        permission_category: "namespace",
      });
      expect(
        (
          await client.query("DELETE FROM inheritance_blocks WHERE id = $1", [
            inheritanceBlockId,
          ])
        ).rowCount
      ).toBe(1);

      const storageBindingId = uuid(1156);
      await insertRow(client, "storage_bindings", {
        id: storageBindingId,
        tenant_id: T1,
        storage_kind: "s3",
        binding_kind: "bucket",
        binding_key: "admin-bucket",
        region: "eu-west-1",
      });
      expect(
        (
          await client.query("DELETE FROM storage_bindings WHERE id = $1", [
            storageBindingId,
          ])
        ).rowCount
      ).toBe(1);

      expect(
        (
          await client.query(
            "UPDATE users SET display_name = $1 WHERE id = $2",
            ["Other Member Updated", U.other]
          )
        ).rowCount
      ).toBe(1);
      expect(
        (
          await client.query("DELETE FROM roles WHERE id = $1", [roleId])
        ).rowCount
      ).toBe(1);
    });
  });
});

describe("org-unit-scoped admin", () => {
  it("sees admin rows in its department and resource scopes", async () => {
    expect(
      new Set(await idsAs(P.adminOu, "SELECT id FROM permissions"))
    ).toEqual(new Set([PERM.read, PERM.write, PERM.admin]));
    expect(await idsAs(P.adminOu, "SELECT id FROM roles")).toEqual([
      ROLE.global,
    ]);
    expect(
      await idsAs(P.adminOu, "SELECT id FROM role_permissions")
    ).toEqual([ROLE_PERMISSION.global]);
    expect(
      new Set(await idsAs(P.adminOu, "SELECT id FROM role_assignments"))
    ).toEqual(
      new Set([
        ROLE_ASSIGNMENT.adminOu,
        ROLE_ASSIGNMENT.writerOu,
        ROLE_ASSIGNMENT.readerOu,
        ROLE_ASSIGNMENT.adminResource,
      ])
    );
    expect(
      await idsAs(P.adminOu, "SELECT id FROM inheritance_blocks")
    ).toEqual([uuid(993)]);
    expect(
      await idsAs(P.adminOu, "SELECT id FROM storage_bindings")
    ).toEqual([]);
    expect(
      new Set(await idsAs(P.adminOu, "SELECT id FROM effective_permissions"))
    ).toEqual(new Set([uuid(883), uuid(884), uuid(885)]));
    expect(
      new Set(await idsAs(P.adminOu, "SELECT id FROM org_units"))
    ).toEqual(new Set([DEPT, TEAM]));
    expect(
      await idsAs(P.adminOu, "SELECT id FROM protected_resources")
    ).toEqual([PROJECT.dept]);
    expect(await idsAs(P.adminOu, "SELECT id FROM credentials")).toEqual([
      CREDENTIAL.dept,
    ]);
    expect(
      new Set(await idsAs(P.adminOu, "SELECT id FROM secrets"))
    ).toEqual(new Set([SECRET.dept, SECRET.global]));
  });

  it("writes within its department scope", async () => {
    await withPrincipal(P.adminOu, async () => {
      const orgUnitId = uuid(1160);
      await insertRow(client, "org_units", {
        id: orgUnitId,
        tenant_id: T1,
        parent_id: DEPT,
        name: "admin-ou-org",
        path: "/root/department/admin-ou-org",
      });
      expect(
        (
          await client.query("UPDATE org_units SET name = $1 WHERE id = $2", [
            "department-updated",
            DEPT,
          ])
        ).rowCount
      ).toBe(1);

      const groupId = uuid(1161);
      await insertRow(client, "groups", {
        id: groupId,
        tenant_id: T1,
        org_unit_id: DEPT,
        name: "admin-ou-group",
      });
      expect(
        (
          await client.query("DELETE FROM groups WHERE id = $1", [groupId])
        ).rowCount
      ).toBe(1);

      const credentialId = uuid(1162);
      await insertRow(client, "credentials", {
        id: credentialId,
        tenant_id: T1,
        org_unit_id: DEPT,
        owner_principal_id: P.adminOu,
        name: "admin-ou-credential",
        credential_type: "password",
        secret_name: "admin-ou-secret",
        provider: "model",
      });
      expect(
        (
          await client.query("DELETE FROM credentials WHERE id = $1", [
            credentialId,
          ])
        ).rowCount
      ).toBe(1);

      const inheritanceBlockId = uuid(1163);
      await insertRow(client, "inheritance_blocks", {
        id: inheritanceBlockId,
        tenant_id: T1,
        org_unit_id: DEPT,
        permission_category: "namespace",
      });
      expect(
        (
          await client.query("DELETE FROM inheritance_blocks WHERE id = $1", [
            inheritanceBlockId,
          ])
        ).rowCount
      ).toBe(1);

      const orgUnitAssignmentId = uuid(1164);
      await insertRow(client, "role_assignments", {
        id: orgUnitAssignmentId,
        tenant_id: T1,
        principal_id: P.readerOu,
        role_id: ROLE.reader,
        scope_kind: "org_unit",
        scope_id: DEPT,
      });
      const resourceAssignmentId = uuid(1165);
      await insertRow(client, "role_assignments", {
        id: resourceAssignmentId,
        tenant_id: T1,
        principal_id: P.adminOu,
        role_id: ROLE.adminOu,
        scope_kind: "resource",
        scope_id: PROJECT.dept,
      });
      expect(
        (
          await client.query("DELETE FROM role_assignments WHERE id = ANY($1)", [
            [orgUnitAssignmentId, resourceAssignmentId],
          ])
        ).rowCount
      ).toBe(2);

      expect(
        (
          await client.query("DELETE FROM org_units WHERE id = $1", [DEPT])
        ).rowCount
      ).toBe(1);
    });
  });

  it("cannot write tenant-scoped admin rows", async () => {
    await insertDeniedAs(P.adminOu, "role_assignments", {
      id: uuid(1170),
      tenant_id: T1,
      principal_id: P.readerOu,
      role_id: ROLE.reader,
      scope_kind: "tenant",
      scope_id: T1,
    });
    await insertDeniedAs(P.adminOu, "storage_bindings", {
      id: uuid(1171),
      tenant_id: T1,
      storage_kind: "s3",
      binding_kind: "bucket",
      binding_key: "admin-ou-bucket",
      region: "eu-west-1",
    });
  });
});

describe("plain active member", () => {
  it("sees only its own identity and memberships", async () => {
    expect(await idsAs(P.plain, "SELECT id FROM users")).toEqual([U.plain]);
    expect(await idsAs(P.plain, "SELECT id FROM principals")).toEqual([
      P.plain,
    ]);
    expect(
      new Set(await idsAs(P.plain, "SELECT id FROM tenant_memberships"))
    ).toEqual(new Set([uuid(966)]));
    const orgUnitMembershipIds = new Set(
      await idsAs(P.plain, "SELECT id FROM org_unit_memberships")
    );
    expect(orgUnitMembershipIds).toContain(uuid(970));
    expect(orgUnitMembershipIds).toContain(uuid(971));
    expect(
      await idsAs(
        P.plain,
        "SELECT id FROM org_unit_memberships WHERE id = $1",
        [uuid(968)]
      )
    ).toEqual([]);
    expect(
      new Set(await idsAs(P.plain, "SELECT id FROM org_units"))
    ).toEqual(new Set([DEPT, TEAM]));
    expect(
      new Set(await idsAs(P.plain, "SELECT id FROM groups"))
    ).toEqual(new Set([GROUP.dept, GROUP.team]));
    expect(
      new Set(await idsAs(P.plain, "SELECT id FROM group_memberships"))
    ).toEqual(new Set([uuid(950), uuid(951)]));
  });

  it("sees own, org-unit-visible, and explicitly granted projects only", async () => {
    expect(
      new Set(await idsAs(P.plain, "SELECT id FROM protected_resources"))
    ).toEqual(
      new Set([
        PROJECT.dept,
        PROJECT.team,
        PROJECT.privatePlain,
        PROJECT.grantedToPlain,
      ])
    );
    expect(
      await idsAs(P.plain, "SELECT id FROM protected_resources WHERE id = $1", [
        PROJECT.privateOther,
      ])
    ).toEqual([]);
    expect(
      await idsAs(P.plain, "SELECT id FROM protected_resources WHERE id = $1", [
        PROJECT.tenant,
      ])
    ).toEqual([]);
  });

  it("sees only credentials and secrets in its own read scope", async () => {
    expect(
      new Set(await idsAs(P.plain, "SELECT id FROM credentials"))
    ).toEqual(new Set([CREDENTIAL.plain, CREDENTIAL.dept]));
    expect(
      new Set(await idsAs(P.plain, "SELECT id FROM secrets"))
    ).toEqual(new Set([SECRET.plain, SECRET.dept]));
    expect(
      await idsAs(P.plain, "SELECT id FROM credentials WHERE id = $1", [
        CREDENTIAL.otherSales,
      ])
    ).toEqual([]);
    expect(
      await idsAs(P.plain, "SELECT id FROM secrets WHERE id = $1", [
        SECRET.otherSales,
      ])
    ).toEqual([]);
    expect(
      await idsAs(P.plain, "SELECT id FROM secrets WHERE id = $1", [
        SECRET.global,
      ])
    ).toEqual([]);
  });

  it("cannot read the administrative machinery or other effective permissions", async () => {
    await expectNoAdminTables(P.plain);
    expect(
      await idsAs(P.plain, "SELECT id FROM effective_permissions")
    ).toEqual([]);
  });

  it("cannot write credentials or secrets even when it owns them", async () => {
    expect(
      await updateCountAs(
        P.plain,
        "credentials",
        CREDENTIAL.plain,
        "name",
        "changed"
      )
    ).toBe(0);
    expect(
      await updateCountAs(P.plain, "secrets", SECRET.plain, "name", "changed")
    ).toBe(0);
    expect(await deleteCountAs(P.plain, "credentials", CREDENTIAL.plain)).toBe(
      0
    );
    expect(await deleteCountAs(P.plain, "secrets", SECRET.plain)).toBe(0);
  });
});

describe("credential and secret restrictions", () => {
  it("lets a scope reader read but not write, and a scope writer write", async () => {
    expect(
      await idsAs(P.reader, "SELECT id FROM credentials WHERE id = $1", [
        CREDENTIAL.tenant,
      ])
    ).toEqual([CREDENTIAL.tenant]);
    expect(
      await updateCountAs(
        P.reader,
        "credentials",
        CREDENTIAL.tenant,
        "name",
        "reader-changed"
      )
    ).toBe(0);
    expect(
      await updateCountAs(
        P.reader,
        "secrets",
        SECRET.tenant,
        "name",
        "reader-changed"
      )
    ).toBe(0);

    expect(
      await updateCountAs(
        P.writer,
        "credentials",
        CREDENTIAL.tenant,
        "name",
        "writer-changed"
      )
    ).toBe(1);
    expect(
      await updateCountAs(
        P.writer,
        "secrets",
        SECRET.tenant,
        "name",
        "writer-changed"
      )
    ).toBe(1);
  });

  it("lets an admin read and write every credential and global secret", async () => {
    expect(
      await idsAs(P.admin, "SELECT id FROM credentials WHERE id = $1", [
        CREDENTIAL.tenant,
      ])
    ).toEqual([CREDENTIAL.tenant]);
    expect(
      await updateCountAs(
        P.admin,
        "credentials",
        CREDENTIAL.tenant,
        "name",
        "admin-changed"
      )
    ).toBe(1);
    expect(
      await updateCountAs(
        P.admin,
        "secrets",
        SECRET.global,
        "name",
        "admin-changed"
      )
    ).toBe(1);
  });

  it("keeps a global secret invisible to non-admins", async () => {
    for (const principal of [P.reader, P.writer, P.readerOu, P.writerOu, P.plain]) {
      expect(
        await idsAs(principal, "SELECT id FROM secrets WHERE id = $1", [
          SECRET.global,
        ])
      ).toEqual([]);
    }
  });
});

describe("org-unit scoped org_units and membership visibility", () => {
  it("lets an org-unit writer update and delete a child org unit it created", async () => {
    await withPrincipal(P.writerOu, async () => {
      const orgUnitId = uuid(1180);
      await insertRow(client, "org_units", {
        id: orgUnitId,
        tenant_id: T1,
        parent_id: DEPT,
        name: "writer-ou-child-org",
        path: "/root/department/writer-ou-child-org",
      });
      const updated = await client.query(
        "UPDATE org_units SET name = $1 WHERE id = $2",
        ["writer-ou-child-org-updated", orgUnitId]
      );
      expect(updated.rowCount).toBe(1);
      const deleted = await client.query(
        "DELETE FROM org_units WHERE id = $1",
        [orgUnitId]
      );
      expect(deleted.rowCount).toBe(1);
    });
  });

  it("lets an org-unit admin update and delete a child org unit it created", async () => {
    await withPrincipal(P.adminOu, async () => {
      const orgUnitId = uuid(1181);
      await insertRow(client, "org_units", {
        id: orgUnitId,
        tenant_id: T1,
        parent_id: DEPT,
        name: "admin-ou-child-org",
        path: "/root/department/admin-ou-child-org",
      });
      const updated = await client.query(
        "UPDATE org_units SET name = $1 WHERE id = $2",
        ["admin-ou-child-org-updated", orgUnitId]
      );
      expect(updated.rowCount).toBe(1);
      const deleted = await client.query(
        "DELETE FROM org_units WHERE id = $1",
        [orgUnitId]
      );
      expect(deleted.rowCount).toBe(1);
    });
  });

  it("shows a plain member only its own org-unit memberships", async () => {
    expect(
      new Set(await idsAs(P.plain, "SELECT id FROM org_unit_memberships"))
    ).toEqual(new Set([uuid(970), uuid(971)]));
  });
});

describe("tenant isolation", () => {
  it("keeps the second tenant's admin inside its own tenant", async () => {
    expect(await idsAs(P.t2Admin, "SELECT id FROM tenants")).toEqual([T2]);
    expect(await idsAs(P.t2Admin, "SELECT id FROM users")).toEqual([U.t2Admin]);
    expect(
      await idsAs(P.t2Admin, "SELECT id FROM protected_resources")
    ).toEqual([PROJECT.t2]);
    expect(await idsAs(P.t2Admin, "SELECT id FROM credentials")).toEqual([
      CREDENTIAL.t2,
    ]);
    expect(
      new Set(await idsAs(P.t2Admin, "SELECT id FROM secrets"))
    ).toEqual(new Set([SECRET.t2, SECRET.global]));
    expect(
      await idsAs(P.t2Admin, "SELECT id FROM secrets WHERE id = $1", [
        SECRET.tenant,
      ])
    ).toEqual([]);
    expect(
      new Set(await idsAs(P.t2Admin, "SELECT id FROM roles"))
    ).toEqual(new Set([ROLE.t2, ROLE.global]));
  });
});
