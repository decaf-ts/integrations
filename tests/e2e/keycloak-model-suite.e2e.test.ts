/**
 * @module integrations/e2e/keycloak-model-suite
 * @summary Full E2E suite with real Keycloak tokens and per-route role verification.
 * @description Provisions a real Keycloak realm with admin/partner/norole users,
 * issues real JWT tokens (verified against the Keycloak JWKS endpoint), and
 * exercises every CRUD route on Product (@roles(["admin"])) and FakePartner
 * (@roles(["partner"])) — verifying that role checks block cross-access and
 * that @createdBy/@updatedBy carry the Keycloak email claim.
 */

import "reflect-metadata";
import { jest, describe, beforeAll, afterAll, it, expect } from "@jest/globals";
import "../../src/nest";

import path from "path";
import { fileURLToPath } from "url";
import { Test } from "@nestjs/testing";
import { INestApplication } from "@nestjs/common";
import { Adapter } from "@decaf-ts/core";
// @ts-expect-error ram
import { RamAdapter, RamFlavour } from "@decaf-ts/core/ram";
import { RamTransformer } from "@decaf-ts/for-http/server";
import {
  DecafAuthModule,
  DecafExceptionFilter,
  DecafModule,
} from "@decaf-ts/for-nest";

import { KeycloakAuthHandler } from "../../src/nest";
import {
  KeycloakAuthService,
  KeycloakService,
  type KeycloakSetupConfig,
  type KeycloakUser,
} from "../../src/keycloak";
import { DockerComposeService } from "../../src/docker";
import { Product } from "./fakes/models/Product";
import { FakePartner } from "./fakes/models/FakePartner";
import { AuthHttpModelClient, genStr } from "./fakes/http";

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

const REALM = `e2e-role-${Math.random().toString(36).slice(2, 10)}`;
const CLIENT_ID = "e2e-role-client";
const CLIENT_SECRET = "e2e-role-secret";

class VerifiedKeycloakAuthHandler extends KeycloakAuthHandler {
  constructor() {
    super();
  }
}

describe("Keycloak full E2E with per-route role verification", () => {
  let app: INestApplication;
  let ProductHttp: AuthHttpModelClient<Product>;
  let PartnerHttp: AuthHttpModelClient<FakePartner>;
  let keycloakService: KeycloakService;
  let keycloakAuthService: KeycloakAuthService;
  let dockerService: DockerComposeService | undefined;
  let adminToken: string;
  let partnerToken: string;
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

  const users: Record<string, KeycloakUser & { roles: string[] }> = {
    admin: {
      realm: REALM,
      apiClientId: CLIENT_ID,
      username: `admin-${Date.now()}`,
      password: "Admin123!",
      roles: ["admin"],
    },
    partner: {
      realm: REALM,
      apiClientId: CLIENT_ID,
      username: `partner-${Date.now()}`,
      password: "Partner123!",
      roles: ["partner"],
    },
    norole: {
      realm: REALM,
      apiClientId: CLIENT_ID,
      username: `norole-${Date.now()}`,
      password: "Norole123!",
      roles: [],
    },
  };

  beforeAll(async () => {
    if (!EXTERNAL_KEYCLOAK_HOST) {
      dockerService = new DockerComposeService();
      await dockerService.initialize({ composeFile, workingDir });
      await dockerService.up();
      await dockerService.waitForHealth(`${KEYCLOAK_BASE_URL}/realms/master`);
      await waitForAdminToken();
    }

    // ── 1. Provision Keycloak realm, client, roles, users ──
    const setup: KeycloakSetupConfig = {
      id: "e2e-role-test",
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
      client: {
        clientId: CLIENT_ID,
        secret: CLIENT_SECRET,
        clientName: "e2e-role-test",
        redirectUris: ["http://localhost/*"],
        webOrigins: ["http://localhost"],
        publicClient: true,
        directAccessGrantsEnabled: true,
        standardFlowEnabled: true,
        serviceAccountsEnabled: false,
        authorizationServicesEnabled: false,
      },
    };

    keycloakService = new KeycloakService();
    await keycloakService.initialize(setup);
    try {
      await keycloakService.deleteOrganization(REALM);
    } catch {
      // realm may not exist on clean run
    }
    await keycloakService.addRealm(REALM, {});
    await new Promise((r) => setTimeout(r, 1000));

    // Create realm roles
    keycloakAuthService = new KeycloakAuthService();
    await keycloakAuthService.initialize(setup);
    const masterToken = await keycloakAuthService.getAccessToken(
      setup.adminApiUser!
    );
    for (const role of ["admin", "partner"]) {
      await fetch(`http://${KEYCLOAK_HOST}/admin/realms/${REALM}/roles`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${masterToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ name: role }),
      });
    }

    // Create client
    await fetch(`http://${KEYCLOAK_HOST}/admin/realms/${REALM}/clients`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${masterToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        clientId: CLIENT_ID,
        name: "e2e-role-test",
        enabled: true,
        clientAuthenticatorType: "client-secret",
        secret: CLIENT_SECRET,
        publicClient: true,
        standardFlowEnabled: true,
        directAccessGrantsEnabled: true,
        serviceAccountsEnabled: false,
        authorizationServicesEnabled: false,
        redirectUris: ["http://localhost/*"],
        webOrigins: ["http://localhost"],
      }),
    });

    // Create users and assign roles
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

    // ── 2. Get real access tokens ──
    adminToken = await keycloakAuthService.getAccessToken(users.admin);
    partnerToken = await keycloakAuthService.getAccessToken(users.partner);
    noroleToken = await keycloakAuthService.getAccessToken(users.norole);

    // ── 3. Build NestJS app with DecafModule + DecafAuthModule ──
    const moduleRef = await Test.createTestingModule({
      imports: [
        DecafAuthModule.forRoot({
          global: true,
          handler: VerifiedKeycloakAuthHandler as any,
        }),
        DecafModule.forRootAsync({
          conf: [[RamAdapter, { UUID: "root" }, new RamTransformer()]],
          autoControllers: true,
        }),
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    app.useGlobalFilters(new DecafExceptionFilter());
    await app.init();

    ProductHttp = new AuthHttpModelClient<Product>(
      app.getHttpServer(),
      Product
    );
    PartnerHttp = new AuthHttpModelClient<FakePartner>(
      app.getHttpServer(),
      FakePartner
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

  // ── CREATE ──
  describe("CREATE role verification", () => {
    it("allows admin to create a Product", async () => {
      const productCode = genStr(14);
      const batchNumber = `BATCH${genStr(3)}`;
      const res = await ProductHttp.post(
        { productCode, batchNumber, name: "Admin Widget" },
        adminToken
      );
      expect(res.status).toBe(201);
      expect(res.toJSON().createdBy).toBe("admin@example.com");
      expect(res.toJSON().updatedBy).toBe("admin@example.com");
    });

    it("blocks partner from creating a Product", async () => {
      const res = await ProductHttp.post(
        { productCode: genStr(14), batchNumber: "B1", name: "Blocked" },
        partnerToken
      );
      expect(res.status).toBeGreaterThanOrEqual(400);
      expect(res.raw.error).toContain("Missing required roles");
    });

    it("blocks norole from creating a Product", async () => {
      const res = await ProductHttp.post(
        { productCode: genStr(14), batchNumber: "B1", name: "Blocked" },
        noroleToken
      );
      expect(res.status).toBeGreaterThanOrEqual(400);
    });

    it("allows partner to create a FakePartner", async () => {
      const id = genStr(6);
      const res = await PartnerHttp.post(
        { id, name: "Acme Corp" },
        partnerToken
      );
      expect(res.status).toBe(201);
      expect(res.toJSON().createdBy).toBe("partner@example.com");
    });

    it("blocks admin from creating a FakePartner", async () => {
      const res = await PartnerHttp.post(
        { id: genStr(6), name: "Blocked" },
        adminToken
      );
      expect(res.status).toBeGreaterThanOrEqual(400);
      expect(res.raw.error).toContain("Missing required roles");
    });
  });

  // ── READ ──
  describe("READ role verification", () => {
    it("allows admin to read a Product it created", async () => {
      const productCode = genStr(14);
      const batchNumber = `BATCH${genStr(3)}`;
      const created = await ProductHttp.post(
        { productCode, batchNumber, name: "Readable" },
        adminToken
      );
      expect(created.status).toBe(201);

      const res = await ProductHttp.get(adminToken, productCode, batchNumber);
      expect(res.status).toBe(200);
      expect(res.toJSON().name).toBe("Readable");
    });

    it("blocks partner from reading a Product", async () => {
      const res = await ProductHttp.get(partnerToken, genStr(14), "B1");
      expect(res.status).toBeGreaterThanOrEqual(400);
    });

    it("allows partner to read a FakePartner it created", async () => {
      const id = genStr(6);
      const created = await PartnerHttp.post(
        { id, name: "Partner Read" },
        partnerToken
      );
      expect(created.status).toBe(201);

      const res = await PartnerHttp.get(partnerToken, id);
      expect(res.status).toBe(200);
      expect(res.toJSON().name).toBe("Partner Read");
    });

    it("blocks admin from reading a FakePartner", async () => {
      const res = await PartnerHttp.get(adminToken, genStr(6));
      expect(res.status).toBeGreaterThanOrEqual(400);
    });
  });

  // ── UPDATE ──
  describe("UPDATE role verification", () => {
    it("allows admin to update a Product and preserves createdBy", async () => {
      const productCode = genStr(14);
      const batchNumber = `BATCH${genStr(3)}`;
      const created = await ProductHttp.post(
        { productCode, batchNumber, name: "Original" },
        adminToken
      );
      expect(created.status).toBe(201);

      const res = await ProductHttp.put(
        { productCode, batchNumber, name: "Updated" },
        adminToken,
        productCode,
        batchNumber
      );
      expect(res.status).toBe(200);
      expect(res.toJSON().name).toBe("Updated");
      expect(res.toJSON().createdBy).toBe("admin@example.com");
      expect(res.toJSON().updatedBy).toBe("admin@example.com");
    });

    it("blocks partner from updating a Product", async () => {
      const res = await ProductHttp.put(
        { productCode: genStr(14), batchNumber: "B1", name: "x" },
        partnerToken,
        genStr(14),
        "B1"
      );
      expect(res.status).toBeGreaterThanOrEqual(400);
    });

    it("allows partner to update a FakePartner", async () => {
      const id = genStr(6);
      const created = await PartnerHttp.post(
        { id, name: "Original Partner" },
        partnerToken
      );
      expect(created.status).toBe(201);

      const res = await PartnerHttp.put(
        { id, name: "Updated Partner" },
        partnerToken,
        id
      );
      expect(res.status).toBe(200);
      expect(res.toJSON().name).toBe("Updated Partner");
    });

    it("blocks admin from updating a FakePartner", async () => {
      const res = await PartnerHttp.put(
        { id: genStr(6), name: "x" },
        adminToken,
        genStr(6)
      );
      expect(res.status).toBeGreaterThanOrEqual(400);
    });
  });

  // ── DELETE ──
  describe("DELETE role verification", () => {
    it("allows admin to delete a Product", async () => {
      const productCode = genStr(14);
      const batchNumber = `BATCH${genStr(3)}`;
      const created = await ProductHttp.post(
        { productCode, batchNumber, name: "Deletable" },
        adminToken
      );
      expect(created.status).toBe(201);

      const del = await ProductHttp.delete(
        adminToken,
        productCode,
        batchNumber
      );
      expect(del.status).toBe(200);

      const getRes = await ProductHttp.get(
        adminToken,
        productCode,
        batchNumber
      );
      expect(getRes.status).toBeGreaterThanOrEqual(400);
    });

    it("blocks partner from deleting a Product", async () => {
      const res = await ProductHttp.delete(partnerToken, genStr(14), "B1");
      expect(res.status).toBeGreaterThanOrEqual(400);
    });

    it("allows partner to delete a FakePartner", async () => {
      const id = genStr(6);
      const created = await PartnerHttp.post(
        { id, name: "Deletable Partner" },
        partnerToken
      );
      expect(created.status).toBe(201);

      const del = await PartnerHttp.delete(partnerToken, id);
      expect(del.status).toBe(200);

      const getRes = await PartnerHttp.get(partnerToken, id);
      expect(getRes.status).toBeGreaterThanOrEqual(400);
    });

    it("blocks admin from deleting a FakePartner", async () => {
      const res = await PartnerHttp.delete(adminToken, genStr(6));
      expect(res.status).toBeGreaterThanOrEqual(400);
    });
  });

  // ── No token / invalid token ──
  describe("Token presence", () => {
    it("blocks requests with no token", async () => {
      const res = await ProductHttp.post(
        { productCode: genStr(14), batchNumber: "B1", name: "x" },
        ""
      );
      expect(res.status).toBeGreaterThanOrEqual(400);
    });

    it("blocks requests with an invalid token", async () => {
      const res = await ProductHttp.post(
        { productCode: genStr(14), batchNumber: "B1", name: "x" },
        "invalid.token.here"
      );
      expect(res.status).toBeGreaterThanOrEqual(400);
    });
  });
});
