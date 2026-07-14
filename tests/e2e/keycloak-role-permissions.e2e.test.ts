/**
 * @module integrations/e2e/keycloak-role-permissions
 * @summary Full E2E suite with per-OPERATION role verification (reader/writer/admin).
 * @description Provisions a real Keycloak realm with reader/writer/admin/norole users,
 * issues real JWT tokens verified against the Keycloak JWKS endpoint, and tests
 * that per-route @RequireRoles decorators enforce:
 *   - readers: can read, query, findAll, findOneBy, listBy
 *   - writers: can create, update (plus everything readers can)
 *   - admins:  can delete (plus everything writers can)
 *   - norole:  blocked from everything
 * Also tests @Public route override: `read` and `findBy` are public (no token
 * required) and bypass the auth interceptor entirely.
 */
import { jest, describe, beforeAll, afterAll, it, expect } from "@jest/globals";

import "reflect-metadata";
import "../../src/nest";

import path from "path";
import { fileURLToPath } from "url";
import { Test } from "@nestjs/testing";
import { INestApplication } from "@nestjs/common";
import { Adapter, ModelService, PersistenceService } from "@decaf-ts/core";
// @ts-expect-error ram
import { RamAdapter, RamFlavour } from "@decaf-ts/core/ram";
import {
  RamTransformer,
  requestToContextTransformer,
} from "@decaf-ts/for-http/server";
import {
  DecafAuthModule,
  DecafCoreModule,
  DecafExceptionFilter,
  DecafModule,
  FromModelController,
  Public,
  RequireRoles,
} from "@decaf-ts/for-nest";

import { KeycloakAuthHandler } from "../../src/nest";
import {
  KeycloakAuthService,
  KeycloakService,
  type KeycloakSetupConfig,
  type KeycloakUser,
} from "../../src/keycloak";
import { DockerComposeService } from "../../src/docker";
import { RoleArticle } from "./fakes/models/RoleArticle";
import { AuthHttpModelClient, genStr } from "./fakes/http";
import request from "supertest";
import { TestJwtService } from "./fakes/jwt";

RamAdapter.decoration();
Adapter.setCurrent(RamFlavour);

jest.setTimeout(180000);

const EXTERNAL_KEYCLOAK_HOST = process.env.KEYCLOAK_HOST;
const KEYCLOAK_HOST = EXTERNAL_KEYCLOAK_HOST || "localhost:8180";
const KEYCLOAK_PROTOCOL =
  (process.env.KEYCLOAK_PROTOCOL as "http" | "https") || "http";
const KEYCLOAK_ADMIN_USER = process.env.KEYCLOAK_ADMIN_USER || "admin";
const KEYCLOAK_ADMIN_PASSWORD = process.env.KEYCLOAK_ADMIN_PASSWORD || "admin";
const KEYCLOAK_BASE_URL = `${KEYCLOAK_PROTOCOL}://${KEYCLOAK_HOST}`;
const testDirname = path.dirname(fileURLToPath(import.meta.url));
const composeFile = path.resolve(testDirname, "../../docker/keycloak-compose.yml");
const workingDir = path.dirname(composeFile);

const REALM = `e2e-roles-${Math.random().toString(36).slice(2, 10)}`;
const CLIENT_ID = "e2e-roles-client";
const CLIENT_SECRET = "e2e-roles-secret";

const READER = "reader";
const WRITER = "writer";
const ADMIN = "admin";

class VerifiedKeycloakAuthHandler extends KeycloakAuthHandler {
  constructor() {
    super();
  }
}

/**
 * Applies for-nest decorator functions (@Public, @RequireRoles) to specific
 * methods on the generated controller.
 *
 * Uses ONLY the Public() and RequireRoles() APIs exported from @decaf-ts/for-nest.
 * No manual Reflect.defineMetadata — the decorators internally call NestJS
 * SetMetadata which stores metadata on descriptor.value (the handler function),
 * which is exactly what AuthInterceptor reads via reflector.getAllAndOverride.
 *
 *   read / findBy           → @Public()               (no token required)
 *   readAll / findOneBy / …  → @RequireRoles("reader")
 *   create / update         → @RequireRoles("writer")
 *   delete                  → @RequireRoles("admin")
 */
function applyRouteAuth(controller: any): void {
  const proto = controller.prototype;

  const decorate = (method: string, decorator: MethodDecorator) => {
    const descriptor = Object.getOwnPropertyDescriptor(proto, method);
    if (descriptor && typeof descriptor.value === "function") {
      decorator(proto, method, descriptor);
    }
  };

  const publicMethods = ["read", "findBy"];
  const readerMethods = [
    "readAll",
    "findOneBy",
    "listBy",
    "find",
    "page",
    "paginateBy",
    "countOf",
    "maxOf",
    "minOf",
    "avgOf",
    "sumOf",
    "distinctOf",
    "groupOf",
    "statement",
  ];
  const writerMethods = ["create", "createAll", "update", "updateAll"];
  const adminMethods = ["delete", "deleteAll"];

  for (const m of publicMethods) {
    decorate(m, Public() as MethodDecorator);
  }
  for (const m of readerMethods) {
    decorate(m, RequireRoles(READER) as MethodDecorator);
  }
  for (const m of writerMethods) {
    decorate(m, RequireRoles(WRITER) as MethodDecorator);
  }
  for (const m of adminMethods) {
    decorate(m, RequireRoles(ADMIN) as MethodDecorator);
  }
}

describe("Keycloak per-operation role E2E (reader/writer/admin)", () => {
  let app: INestApplication;
  let ArticleHttp: AuthHttpModelClient<RoleArticle>;
  let keycloakService: KeycloakService;
  let keycloakAuthService: KeycloakAuthService;
let dockerService: DockerComposeService | undefined;
  let readerToken: string;
  let writerToken: string;
  let adminToken: string;
  let noroleToken: string;

  async function waitForAdminToken(): Promise<void> {
    const tokenUrl = `${KEYCLOAK_BASE_URL}/realms/master/protocol/openid-connect/token`;
    const body = new URLSearchParams({
      client_id: "admin-cli",
      username: KEYCLOAK_ADMIN_USER,
      password: KEYCLOAK_ADMIN_PASSWORD,
      grant_type: "password",
    }).toString();

    let lastError: unknown;
    for (let attempt = 0; attempt < 30; attempt += 1) {
      try {
        const response = await fetch(tokenUrl, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body,
        });
        const data = await response.json().catch(() => undefined);
        if (response.ok && data?.access_token) return;
        lastError = new Error(
          `Keycloak token not ready (${response.status}): ${JSON.stringify(data)}`
        );
      } catch (error) {
        lastError = error;
      }
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }

    throw lastError instanceof Error
      ? lastError
      : new Error("Keycloak token endpoint did not become ready");
  }

  beforeAll(async () => {
    await new TestJwtService().boot({});

    if (!EXTERNAL_KEYCLOAK_HOST) {
      dockerService = new DockerComposeService();
      await dockerService.initialize({ composeFile, workingDir });
      await dockerService.up();
      await dockerService.waitForHealth(`${KEYCLOAK_BASE_URL}/realms/master`);
      await waitForAdminToken();
    }

    // ── 1. Provision Keycloak realm, realm-admin, client via setupOrganization ──
    const setup: KeycloakSetupConfig = {
      id: "e2e-roles-test",
      host: KEYCLOAK_HOST,
      protocol: KEYCLOAK_PROTOCOL,
      isProduction: () => false,
      rootApiUser: {
        realm: "master",
        apiClientId: "admin-cli",
        username: KEYCLOAK_ADMIN_USER,
        password: KEYCLOAK_ADMIN_PASSWORD,
      },
      adminApiUser: {
        realm: "master",
        apiClientId: "admin-cli",
        username: KEYCLOAK_ADMIN_USER,
        password: KEYCLOAK_ADMIN_PASSWORD,
      },
      realmApiUser: {
        realm: REALM,
        apiClientId: "admin-cli",
        username: `realm-admin-${Date.now()}`,
        password: "RealmAdmin123!",
      },
      client: {
        clientId: CLIENT_ID,
        secret: CLIENT_SECRET,
        clientName: "e2e-roles-test",
        redirectUris: ["http://localhost/*"],
        webOrigins: ["http://localhost"],
        publicClient: true,
        directAccessGrantsEnabled: true,
        standardFlowEnabled: true,
        serviceAccountsEnabled: false,
        authorizationServicesEnabled: false,
      },
      // When false (default), roles are independent — admin does NOT imply
      // writer or reader.  Set to true for Keycloak composite role hierarchy.
      useCompositeRoles: false,
    };

    const useCompositeRoles = setup.useCompositeRoles ?? false;

    keycloakService = new KeycloakService();
    await keycloakService.initialize(setup);
    try {
      await keycloakService.deleteOrganization(REALM);
    } catch {
      // realm may not exist on clean run
    }

    // setupOrganization creates the realm, a realm-admin user with
    // manage-clients permission, and the client — all via service methods.
    await keycloakService.setupOrganization(setup);
    await new Promise((r) => setTimeout(r, 1000));

    // ── 2. Create realm roles via keycloakService.createRealmRole ──
    if (useCompositeRoles) {
      // Composite: admin ⊃ writer ⊃ reader
      await keycloakService.createRealmRole(REALM, READER, undefined);
      await keycloakService.createRealmRole(REALM, WRITER, [READER]);
      await keycloakService.createRealmRole(REALM, ADMIN, [WRITER]);
    } else {
      // Independent roles — no hierarchy
      await keycloakService.createRealmRole(REALM, READER, undefined);
      await keycloakService.createRealmRole(REALM, WRITER, undefined);
      await keycloakService.createRealmRole(REALM, ADMIN, undefined);
    }

    // ── 3. Create test users and assign roles ──
    keycloakAuthService = new KeycloakAuthService();
    await keycloakAuthService.initialize(setup);

    // When useCompositeRoles is false, each user gets all the roles they need
    // explicitly.  When true, composite expansion handles inheritance.
    const rolesFor = (base: string[]): string[] => {
      if (useCompositeRoles) return base;
      if (base.includes(ADMIN)) return [READER, WRITER, ADMIN];
      if (base.includes(WRITER)) return [READER, WRITER];
      return base;
    };

    const users: Record<string, KeycloakUser & { roles: string[] }> = {
      reader: {
        realm: REALM,
        apiClientId: CLIENT_ID,
        username: `reader-${Date.now()}`,
        password: "Reader123!",
        roles: rolesFor([READER]),
      },
      writer: {
        realm: REALM,
        apiClientId: CLIENT_ID,
        username: `writer-${Date.now()}`,
        password: "Writer123!",
        roles: rolesFor([WRITER]),
      },
      admin: {
        realm: REALM,
        apiClientId: CLIENT_ID,
        username: `admin-${Date.now()}`,
        password: "Admin123!",
        roles: rolesFor([ADMIN]),
      },
      norole: {
        realm: REALM,
        apiClientId: CLIENT_ID,
        username: `norole-${Date.now()}`,
        password: "Norole123!",
        roles: [],
      },
    };

    for (const [key, user] of Object.entries(users)) {
      const uuid = await keycloakService.addUserToRealm(user, {
        enabled: true,
        emailVerified: true,
        firstName: key,
        lastName: "Test",
        email: `${key}@example.com`,
      });
      if (user.roles.length > 0) {
        await keycloakService.addRealmRolesToUser(REALM, uuid, user.roles);
      }
    }

    // ── 4. Get real access tokens ──
    readerToken = await keycloakAuthService.getAccessToken(users.reader);
    writerToken = await keycloakAuthService.getAccessToken(users.writer);
    adminToken = await keycloakAuthService.getAccessToken(users.admin);
    noroleToken = await keycloakAuthService.getAccessToken(users.norole);

    // ── 3. Manually boot the adapter so FromModelController.create() works ──
    // The adapter self-registers in Adapter._cache via its constructor.
    // We set DecafCoreModule._persistence so forRootAsync() skips re-booting.
    const persistence = new PersistenceService();
    await persistence.boot([[RamAdapter, { UUID: "root" }]] as any);
    (DecafCoreModule as any)._persistence = persistence;
    requestToContextTransformer(RamFlavour)(new RamTransformer());

    // ── 4. Warm the model service (autoControllers:false skips this) ──
    ModelService.forModel(RoleArticle as any);

    // ── 5. Generate controller and apply per-operation roles ──
    const ArticleController = FromModelController.create(RoleArticle);
    applyRouteAuth(ArticleController);

    // ── 6. Build NestJS app ──
    const moduleRef = await Test.createTestingModule({
      imports: [
        DecafAuthModule.forRoot({
          global: true,
          handler: VerifiedKeycloakAuthHandler as any,
        }),
        DecafModule.forRootAsync({
          conf: [[RamAdapter, { UUID: "root" }, new RamTransformer()]],
          autoControllers: false,
        }),
      ],
      controllers: [ArticleController as any],
    }).compile();

    app = moduleRef.createNestApplication();
    app.useGlobalFilters(new DecafExceptionFilter());
    await app.init();

    ArticleHttp = new AuthHttpModelClient<RoleArticle>(
      app.getHttpServer(),
      RoleArticle
    );
  });

  afterAll(async () => {
    if (app) await app.close();
    try {
      await keycloakService?.deleteOrganization(REALM);
    } catch {
      // ignore
    }
    if (dockerService) {
      await dockerService.down();
    }
  });

  // ──────────────────────────────────────────────
  //  CREATE (writer + admin only)
  // ──────────────────────────────────────────────
  describe("CREATE — writer + admin only", () => {
    it("allows writer to create an article", async () => {
      const id = genStr(8);
      const res = await ArticleHttp.post(
        { id, title: "Writer Article", body: "Content", category: "tech" },
        writerToken
      );
      expect(res.status).toBe(201);
      expect(res.toJSON().createdBy).toBe("writer@example.com");
      expect(res.toJSON().updatedBy).toBe("writer@example.com");
    });

    it("allows admin to create an article", async () => {
      const id = genStr(8);
      const res = await ArticleHttp.post(
        { id, title: "Admin Article", body: "Content", category: "news" },
        adminToken
      );
      expect(res.status).toBe(201);
      expect(res.toJSON().createdBy).toBe("admin@example.com");
    });

    it("blocks reader from creating an article", async () => {
      const res = await ArticleHttp.post(
        { id: genStr(8), title: "Blocked", body: "x", category: "tech" },
        readerToken
      );
      expect(res.status).toBeGreaterThanOrEqual(400);
      expect(res.raw.error).toContain("Missing required roles");
    });

    it("blocks norole from creating an article", async () => {
      const res = await ArticleHttp.post(
        { id: genStr(8), title: "Blocked", body: "x", category: "tech" },
        noroleToken
      );
      expect(res.status).toBeGreaterThanOrEqual(400);
    });
  });

  // ──────────────────────────────────────────────
  //  @Public routes — no token required, bypasses auth interceptor
  //  (read / GET /:id and findBy / GET /findBy/:key/:value)
  // ──────────────────────────────────────────────
  describe("@Public routes — no token required", () => {
    it("allows reading a single article WITHOUT any token", async () => {
      const id = genStr(8);
      const created = await ArticleHttp.post(
        { id, title: "Public Readable", body: "Content", category: "tech" },
        writerToken
      );
      expect(created.status).toBe(201);

      const res = await ArticleHttp.get("", id);
      expect(res.status).toBe(200);
      expect(res.toJSON().title).toBe("Public Readable");
    });

    it("allows reading with a token too (token ignored on public routes)", async () => {
      const id = genStr(8);
      const created = await ArticleHttp.post(
        { id, title: "Token Readable", body: "Content", category: "tech" },
        writerToken
      );
      expect(created.status).toBe(201);

      const res = await ArticleHttp.get(writerToken, id);
      expect(res.status).toBe(200);
    });

    it("allows reading with a norole token (public overrides roles)", async () => {
      const id = genStr(8);
      const created = await ArticleHttp.post(
        { id, title: "Norole Readable", body: "Content", category: "tech" },
        writerToken
      );
      expect(created.status).toBe(201);

      const res = await ArticleHttp.get(noroleToken, id);
      expect(res.status).toBe(200);
    });

    it("allows findBy WITHOUT any token", async () => {
      const res = await request(app.getHttpServer())
        .get("/role-article/findBy/title/Public%20Readable")
        .set("Authorization", "");
      expect(res.status).toBe(200);
    });

    it("allows findBy with an invalid token (public bypasses verification)", async () => {
      const res = await request(app.getHttpServer())
        .get("/role-article/findBy/title/Public%20Readable")
        .set("Authorization", "Bearer invalid.token.here");
      expect(res.status).toBe(200);
    });
  });

  // ──────────────────────────────────────────────
  //  PROTECTED READ routes (reader + writer + admin) — readAll, findOneBy, etc.
  //  (read and findBy are @Public, see above)
  // ──────────────────────────────────────────────
  describe("PROTECTED READ — reader + writer + admin", () => {
    it("allows reader to readAll (auth passes, not 401/403)", async () => {
      const id = genStr(8);
      const created = await ArticleHttp.post(
        { id, title: "Bulk Read", body: "Content", category: "tech" },
        writerToken
      );
      expect(created.status).toBe(201);

      const res = await request(app.getHttpServer())
        .get("/role-article/bulk")
        .query({ ids: id })
        .set("Authorization", `Bearer ${readerToken}`);
      expect(res.status).not.toBe(401);
      expect(res.status).not.toBe(403);
    });

    it("blocks norole from readAll", async () => {
      const res = await request(app.getHttpServer())
        .get("/role-article/bulk")
        .query({ ids: genStr(8) })
        .set("Authorization", `Bearer ${noroleToken}`);
      expect(res.status).toBeGreaterThanOrEqual(400);
    });
  });

  // ──────────────────────────────────────────────
  //  QUERY / findOneBy (reader + writer + admin)
  //  (findBy is @Public, see above)
  // ──────────────────────────────────────────────
  describe("QUERY — reader + writer + admin", () => {
    it("allows reader to findOneBy (auth passes, not 401/403)", async () => {
      const res = await request(app.getHttpServer())
        .get("/role-article/findOneBy/title/Readable")
        .set("Authorization", `Bearer ${readerToken}`);
      expect(res.status).not.toBe(401);
      expect(res.status).not.toBe(403);
    });

    it("blocks norole from querying (findOneBy)", async () => {
      const res = await request(app.getHttpServer())
        .get("/role-article/findOneBy/title/x")
        .set("Authorization", `Bearer ${noroleToken}`);
      expect(res.status).toBeGreaterThanOrEqual(400);
    });
  });

  // ──────────────────────────────────────────────
  //  UPDATE (writer + admin only)
  // ──────────────────────────────────────────────
  describe("UPDATE — writer + admin only", () => {
    it("allows writer to update an article", async () => {
      const id = genStr(8);
      const created = await ArticleHttp.post(
        { id, title: "Original", body: "Content", category: "tech" },
        writerToken
      );
      expect(created.status).toBe(201);

      const res = await ArticleHttp.put(
        { id, title: "Updated by Writer", body: "Content", category: "tech" },
        writerToken,
        id
      );
      expect(res.status).toBe(200);
      expect(res.toJSON().title).toBe("Updated by Writer");
      expect(res.toJSON().createdBy).toBe("writer@example.com");
      expect(res.toJSON().updatedBy).toBe("writer@example.com");
    });

    it("allows admin to update an article (preserves createdBy)", async () => {
      const id = genStr(8);
      const created = await ArticleHttp.post(
        { id, title: "Original", body: "Content", category: "tech" },
        writerToken
      );
      expect(created.status).toBe(201);

      const res = await ArticleHttp.put(
        { id, title: "Updated by Admin", body: "Content", category: "tech" },
        adminToken,
        id
      );
      expect(res.status).toBe(200);
      expect(res.toJSON().title).toBe("Updated by Admin");
      expect(res.toJSON().createdBy).toBe("writer@example.com");
      expect(res.toJSON().updatedBy).toBe("admin@example.com");
    });

    it("blocks reader from updating an article", async () => {
      const id = genStr(8);
      const created = await ArticleHttp.post(
        { id, title: "Original", body: "Content", category: "tech" },
        writerToken
      );
      expect(created.status).toBe(201);

      const res = await ArticleHttp.put(
        { id, title: "Blocked Update", body: "x", category: "tech" },
        readerToken,
        id
      );
      expect(res.status).toBeGreaterThanOrEqual(400);
      expect(res.raw.error).toContain("Missing required roles");
    });

    it("blocks norole from updating an article", async () => {
      const res = await ArticleHttp.put(
        { id: genStr(8), title: "x", body: "x", category: "tech" },
        noroleToken,
        genStr(8)
      );
      expect(res.status).toBeGreaterThanOrEqual(400);
    });
  });

  // ──────────────────────────────────────────────
  //  DELETE (admin only)
  // ──────────────────────────────────────────────
  describe("DELETE — admin only", () => {
    it("allows admin to delete an article", async () => {
      const id = genStr(8);
      const created = await ArticleHttp.post(
        { id, title: "Deletable", body: "Content", category: "tech" },
        adminToken
      );
      expect(created.status).toBe(201);

      const del = await ArticleHttp.delete(adminToken, id);
      expect(del.status).toBe(200);

      const getRes = await ArticleHttp.get(adminToken, id);
      expect(getRes.status).toBeGreaterThanOrEqual(400);
    });

    it("blocks writer from deleting an article", async () => {
      const id = genStr(8);
      const created = await ArticleHttp.post(
        { id, title: "No Delete", body: "Content", category: "tech" },
        writerToken
      );
      expect(created.status).toBe(201);

      const res = await ArticleHttp.delete(writerToken, id);
      expect(res.status).toBeGreaterThanOrEqual(400);
      expect(res.raw.error).toContain("Missing required roles");

      await ArticleHttp.delete(adminToken, id);
    });

    it("blocks reader from deleting an article", async () => {
      const id = genStr(8);
      const created = await ArticleHttp.post(
        { id, title: "No Delete", body: "Content", category: "tech" },
        writerToken
      );
      expect(created.status).toBe(201);

      const res = await ArticleHttp.delete(readerToken, id);
      expect(res.status).toBeGreaterThanOrEqual(400);

      await ArticleHttp.delete(adminToken, id);
    });

    it("blocks norole from deleting an article", async () => {
      const res = await ArticleHttp.delete(noroleToken, genStr(8));
      expect(res.status).toBeGreaterThanOrEqual(400);
    });
  });

  // ──────────────────────────────────────────────
  //  Token presence / validity
  // ──────────────────────────────────────────────
  describe("Token presence and validity", () => {
    it("blocks requests with no token", async () => {
      const res = await ArticleHttp.post(
        { id: genStr(8), title: "x", body: "x", category: "tech" },
        ""
      );
      expect(res.status).toBeGreaterThanOrEqual(400);
    });

    it("blocks requests with an invalid token", async () => {
      const res = await ArticleHttp.post(
        { id: genStr(8), title: "x", body: "x", category: "tech" },
        "invalid.token.here"
      );
      expect(res.status).toBeGreaterThanOrEqual(400);
    });
  });

  // ──────────────────────────────────────────────
  //  Cross-role summary matrix
  // ──────────────────────────────────────────────
  describe("Role permission matrix summary", () => {
    it("verifies the full role×operation matrix in one test", async () => {
      const id = genStr(8);

      // CREATE: writer can, reader cannot
      const writerCreate = await ArticleHttp.post(
        { id, title: "Matrix", body: "Content", category: "tech" },
        writerToken
      );
      expect(writerCreate.status).toBe(201);

      const readerCreate = await ArticleHttp.post(
        { id: genStr(8), title: "x", body: "x", category: "tech" },
        readerToken
      );
      expect(readerCreate.status).toBeGreaterThanOrEqual(400);

      // READ (@Public): reader, writer, norole, and no-token ALL can read
      const readerRead = await ArticleHttp.get(readerToken, id);
      expect(readerRead.status).toBe(200);

      const writerRead = await ArticleHttp.get(writerToken, id);
      expect(writerRead.status).toBe(200);

      const noroleRead = await ArticleHttp.get(noroleToken, id);
      expect(noroleRead.status).toBe(200);

      const noTokenRead = await ArticleHttp.get("", id);
      expect(noTokenRead.status).toBe(200);

      // UPDATE: writer can, reader cannot
      const writerUpdate = await ArticleHttp.put(
        { id, title: "Matrix Updated", body: "Content", category: "tech" },
        writerToken,
        id
      );
      expect(writerUpdate.status).toBe(200);

      const readerUpdate = await ArticleHttp.put(
        { id, title: "Blocked", body: "x", category: "tech" },
        readerToken,
        id
      );
      expect(readerUpdate.status).toBeGreaterThanOrEqual(400);

      // DELETE: admin can, writer cannot, reader cannot
      const writerDelete = await ArticleHttp.delete(writerToken, id);
      expect(writerDelete.status).toBeGreaterThanOrEqual(400);

      const readerDelete = await ArticleHttp.delete(readerToken, id);
      expect(readerDelete.status).toBeGreaterThanOrEqual(400);

      const adminDelete = await ArticleHttp.delete(adminToken, id);
      expect(adminDelete.status).toBe(200);
    });
  });
});
