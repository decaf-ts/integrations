/**
 * @module integrations/e2e/keycloak-auth
 * @summary E2E test for KeycloakAuthHandler with auto-generated Decaf controllers.
 * @description Tests the full auth → context → persistence → @createdBy flow
 * across TWO adapters (RamAdapter "ram" + FsAdapter "fs"), each with its own
 * transformer. Verifies that the Keycloak user's email (extracted from the JWT
 * by the auth handler) consistently appears in `@createdBy` and `@updatedBy`
 * for models on both adapters.
 */
import { jest, describe, beforeAll, afterAll, it, expect } from "@jest/globals";

import "../../src/nest";

import { Test } from "@nestjs/testing";
import { INestApplication } from "@nestjs/common";
import {
  DecafExceptionFilter,
  DecafModule,
  DecafAuthModule,
} from "@decaf-ts/for-nest";
import { RamTransformer } from "@decaf-ts/for-http/server";
// @ts-expect-error ram
import { RamAdapter, RamFlavour } from "@decaf-ts/core/ram";
import { Adapter } from "@decaf-ts/core";

import { KeycloakAuthHandler } from "../../src/nest";
import { Product } from "./fakes/models/Product";
import { FakePartner } from "./fakes/models/FakePartner";
import { FsProduct } from "./fakes/models/FsProduct";
import { FsAdapter } from "./fakes/FsAdapter";
import { FsTransformer } from "./fakes/FsTransformer";
import { AuthHttpModelClient, genStr } from "./fakes/http";
import {
  ADMIN_TOKEN,
  ADMIN_USER,
  PARTNER_TOKEN,
  PARTNER_USER,
  NOROLE_TOKEN,
  buildUserToken,
} from "./fakes/jwt";

RamAdapter.decoration();
Adapter.setCurrent(RamFlavour);

function expectedCreator(user: { email?: string }): string {
  if (!user?.email) {
    throw new Error("Test token is missing an email claim");
  }
  return user.email;
}

jest.setTimeout(180000);

describe("KeycloakAuthHandler (e2e)", () => {
  let app: INestApplication;
  let ProductHttp: AuthHttpModelClient<Product>;
  let PartnerHttp: AuthHttpModelClient<FakePartner>;
  let FsProductHttp: AuthHttpModelClient<FsProduct>;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        DecafAuthModule.forRoot({
          global: true,
          handler: KeycloakAuthHandler as any,
        }),
        DecafModule.forRootAsync({
          conf: [
            [RamAdapter, { user: "root" }, new RamTransformer()],
            [FsAdapter, { rootDir: "/tmp/decaf-fs-e2e" }, new FsTransformer()],
          ],
          autoControllers: true,
        }),
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    app.useGlobalFilters(new DecafExceptionFilter());
    await app.init();

    ProductHttp = new AuthHttpModelClient<Product>(app.getHttpServer(), Product);
    PartnerHttp = new AuthHttpModelClient<FakePartner>(
      app.getHttpServer(),
      FakePartner
    );
    FsProductHttp = new AuthHttpModelClient<FsProduct>(
      app.getHttpServer(),
      FsProduct
    );
  });

  afterAll(async () => {
    await app.close();
  });

  describe("CREATE", () => {
    it("allows admin to create a Product (model role: admin, ram adapter)", async () => {
      const productCode = genStr(14);
      const batchNumber = `BATCH${genStr(3)}`;
      const payload = { productCode, batchNumber, name: "Widget" };
      const creator = expectedCreator(ADMIN_USER);

      const res = await ProductHttp.post(payload, ADMIN_TOKEN);

      expect(res.status).toBe(201);
      expect(res.toJSON()).toMatchObject(payload);
      expect(res.toJSON().createdBy).toBe(creator);
    });

    it("blocks partner from creating a Product (model role: admin, token role: partner)", async () => {
      const productCode = genStr(14);
      const batchNumber = `BATCH${genStr(3)}`;
      const payload = { productCode, batchNumber, name: "Blocked" };

      const res = await ProductHttp.post(payload, PARTNER_TOKEN);

      expect(res.status).toBeGreaterThanOrEqual(400);
      expect(res.raw.error).toContain("Missing required roles");
    });

    it("allows partner to create a FakePartner (model role: partner)", async () => {
      const id = genStr(6);
      const payload = { id, name: "Acme Corp" };
      const creator = expectedCreator(PARTNER_USER);

      const res = await PartnerHttp.post(payload, PARTNER_TOKEN);

      expect(res.status).toBe(201);
      expect(res.toJSON()).toMatchObject(payload);
      expect(res.toJSON().createdBy).toBe(creator);
    });

    it("blocks admin from creating a FakePartner (model role: partner, token role: admin)", async () => {
      const id = genStr(6);
      const payload = { id, name: "Blocked" };

      const res = await PartnerHttp.post(payload, ADMIN_TOKEN);

      expect(res.status).toBeGreaterThanOrEqual(400);
      expect(res.raw.error).toContain("Missing required roles");
    });

    it("blocks users with no roles from any protected route", async () => {
      const res = await ProductHttp.post(
        { productCode: genStr(14), batchNumber: "B1", name: "x" },
        NOROLE_TOKEN
      );
      expect(res.status).toBeGreaterThanOrEqual(400);
    });

    it("blocks requests with no token at all", async () => {
      const res = await ProductHttp.post(
        { productCode: genStr(14), batchNumber: "B1", name: "x" },
        ""
      );
      expect(res.status).toBeGreaterThanOrEqual(400);
    });
  });

  describe("READ", () => {
    it("allows admin to read a Product it created", async () => {
      const productCode = genStr(14);
      const batchNumber = `BATCH${genStr(3)}`;
      const payload = { productCode, batchNumber, name: "Readable" };

      const created = await ProductHttp.post(payload, ADMIN_TOKEN);
      expect(created.status).toBe(201);

      const res = await ProductHttp.get(ADMIN_TOKEN, productCode, batchNumber);
      expect(res.status).toBe(200);
      expect(res.toJSON()).toMatchObject(payload);
    });

    it("blocks partner from reading a Product", async () => {
      const res = await ProductHttp.get(PARTNER_TOKEN, genStr(14), "B1");
      expect(res.status).toBeGreaterThanOrEqual(400);
    });

    it("allows partner to read a FakePartner it created", async () => {
      const id = genStr(6);
      const payload = { id, name: "Partner Read" };

      const created = await PartnerHttp.post(payload, PARTNER_TOKEN);
      expect(created.status).toBe(201);

      const res = await PartnerHttp.get(PARTNER_TOKEN, id);
      expect(res.status).toBe(200);
      expect(res.toJSON()).toMatchObject(payload);
    });
  });

  describe("UPDATE", () => {
    it("allows admin to update a Product and preserves createdBy", async () => {
      const productCode = genStr(14);
      const batchNumber = `BATCH${genStr(3)}`;
      const payload = { productCode, batchNumber, name: "Original" };
      const creator = expectedCreator(ADMIN_USER);

      const created = await ProductHttp.post(payload, ADMIN_TOKEN);
      expect(created.status).toBe(201);

      const res = await ProductHttp.put(
        { ...payload, name: "Updated" },
        ADMIN_TOKEN,
        productCode,
        batchNumber
      );
      expect(res.status).toBe(200);
      expect(res.toJSON().name).toBe("Updated");
      expect(res.toJSON().createdBy).toBe(creator);
    });

    it("blocks partner from updating a Product", async () => {
      const res = await ProductHttp.put(
        { productCode: genStr(14), batchNumber: "B1", name: "x" },
        PARTNER_TOKEN,
        genStr(14),
        "B1"
      );
      expect(res.status).toBeGreaterThanOrEqual(400);
    });
  });

  describe("DELETE", () => {
    it("allows admin to delete a Product", async () => {
      const productCode = genStr(14);
      const batchNumber = `BATCH${genStr(3)}`;
      const payload = { productCode, batchNumber, name: "Deletable" };

      const created = await ProductHttp.post(payload, ADMIN_TOKEN);
      expect(created.status).toBe(201);

      const del = await ProductHttp.delete(ADMIN_TOKEN, productCode, batchNumber);
      expect(del.status).toBe(200);

      const getRes = await ProductHttp.get(ADMIN_TOKEN, productCode, batchNumber);
      expect(getRes.status).toBeGreaterThanOrEqual(400);
    });

    it("blocks partner from deleting a Product", async () => {
      const del = await ProductHttp.delete(PARTNER_TOKEN, genStr(14), "B1");
      expect(del.status).toBeGreaterThanOrEqual(400);
    });
  });

  describe("User/Organization context binding", () => {
    it("populates createdBy with the JWT email claim (not the username)", async () => {
      const token = buildUserToken({
        email: "custom@example.com",
        preferred_username: "customuser",
        roles: ["admin"],
      });

      const productCode = genStr(14);
      const batchNumber = `BATCH${genStr(3)}`;
      const res = await ProductHttp.post(
        { productCode, batchNumber, name: "Context Test" },
        token
      );

      expect(res.status).toBe(201);
      expect(res.toJSON().createdBy).toBe("custom@example.com");
    });

    it("falls back to preferred_username when email is absent", async () => {
      const token = buildUserToken({
        preferred_username: "usernameonly",
        roles: ["admin"],
      });

      const productCode = genStr(14);
      const batchNumber = `BATCH${genStr(3)}`;
      const res = await ProductHttp.post(
        { productCode, batchNumber, name: "Username Test" },
        token
      );

      expect(res.status).toBe(201);
      expect(res.toJSON().createdBy).toBeTruthy();
    });

    it("extracts organization from the aud claim", async () => {
      const token = buildUserToken({
        email: "orgtest@example.com",
        preferred_username: "orgtest",
        roles: ["admin"],
        audience: "my-org-client",
      });

      const productCode = genStr(14);
      const batchNumber = `BATCH${genStr(3)}`;
      const res = await ProductHttp.post(
        { productCode, batchNumber, name: "Org Test" },
        token
      );

      expect(res.status).toBe(201);
      expect(res.toJSON().createdBy).toBe("orgtest@example.com");
    });
  });

  describe("Multi-adapter consistency (ram + fs)", () => {
    it("creates a Product on the ram adapter with @createdBy = JWT email", async () => {
      const productCode = genStr(14);
      const batchNumber = `BATCH${genStr(3)}`;
      const res = await ProductHttp.post(
        { productCode, batchNumber, name: "Ram Product" },
        ADMIN_TOKEN
      );

      expect(res.status).toBe(201);
      expect(res.toJSON().createdBy).toBe("admin@example.com");
      expect(res.toJSON().updatedBy).toBe("admin@example.com");
    });

    it("creates an FsProduct on the fs adapter with @createdBy = JWT email", async () => {
      const id = genStr(10);
      const res = await FsProductHttp.post(
        { id, name: "Fs Product" },
        ADMIN_TOKEN
      );

      expect(res.status).toBe(201);
      expect(res.toJSON().createdBy).toBe("admin@example.com");
      expect(res.toJSON().updatedBy).toBe("admin@example.com");
    });

    it("updates an FsProduct and preserves createdBy while setting updatedBy", async () => {
      const id = genStr(10);
      const created = await FsProductHttp.post(
        { id, name: "Original Fs" },
        ADMIN_TOKEN
      );
      expect(created.status).toBe(201);
      expect(created.toJSON().createdBy).toBe("admin@example.com");

      // Update with a different user
      const partnerToken = buildUserToken({
        email: "partner@example.com",
        preferred_username: "partner",
        roles: ["admin"],
      });

      const res = await FsProductHttp.put(
        { id, name: "Updated Fs" },
        partnerToken,
        id
      );

      expect(res.status).toBe(200);
      expect(res.toJSON().name).toBe("Updated Fs");
      // createdBy must reflect the original creator
      expect(res.toJSON().createdBy).toBe("admin@example.com");
      // updatedBy must reflect the user who performed the update
      expect(res.toJSON().updatedBy).toBe("partner@example.com");
    });

    it("reads an FsProduct and verifies createdBy consistency", async () => {
      const token = buildUserToken({
        email: "fsreader@example.com",
        preferred_username: "fsreader",
        roles: ["admin"],
      });

      const id = genStr(10);
      const created = await FsProductHttp.post(
        { id, name: "Read Consistency" },
        token
      );
      expect(created.status).toBe(201);
      expect(created.toJSON().createdBy).toBe("fsreader@example.com");

      const res = await FsProductHttp.get(ADMIN_TOKEN, id);
      expect(res.status).toBe(200);
      expect(res.toJSON().createdBy).toBe("fsreader@example.com");
    });

    it("blocks partner from accessing FsProduct (model role: admin)", async () => {
      const res = await FsProductHttp.post(
        { id: genStr(10), name: "Blocked Fs" },
        PARTNER_TOKEN
      );
      expect(res.status).toBeGreaterThanOrEqual(400);
      expect(res.raw.error).toContain("Missing required roles");
    });

    it("deletes an FsProduct", async () => {
      const id = genStr(10);
      const created = await FsProductHttp.post(
        { id, name: "Deletable Fs" },
        ADMIN_TOKEN
      );
      expect(created.status).toBe(201);

      const del = await FsProductHttp.delete(ADMIN_TOKEN, id);
      expect(del.status).toBe(200);

      const getRes = await FsProductHttp.get(ADMIN_TOKEN, id);
      expect(getRes.status).toBeGreaterThanOrEqual(400);
    });
  });
});
