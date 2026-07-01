/**
 * @module integrations/e2e/keycloak-model-suite
 * @summary E2E suite for Keycloak-backed Decaf models across Ram + Nano adapters.
 * @description Repeats the for-nest model suite (CRUD, bulk, query, statement, SSE)
 * using a real Keycloak realm for auth. Verifies that @createdBy/@updatedBy are
 * populated from the Keycloak token extracted by the auth handler.
 */
import "reflect-metadata";
import { jest, describe, beforeAll, afterAll, it, expect, beforeEach } from "@jest/globals";

import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import {
  Adapter,
  AuthorizationError,
  column,
  createdAt,
  createdBy,
  defaultQueryAttr,
  OrderDirection,
  pk,
  roles,
  table,
  updatedAt,
  updatedBy,
  type Observer,
} from "@decaf-ts/core";
import {
  Model,
  type ModelArg,
  model,
  required,
} from "@decaf-ts/decorator-validation";
import { composed, InternalError, OperationKeys } from "@decaf-ts/db-decorators";
import { RamAdapter, RamFlavour } from "@decaf-ts/core/ram";
import { NanoAdapter, NanoFlavour } from "@decaf-ts/for-nano";
import { AxiosHttpAdapter, RestService } from "@decaf-ts/for-http";
import {
  AuthHandler,
  RamTransformer,
  RequestToContextTransformer,
  requestToContextTransformer,
} from "@decaf-ts/for-http/server";
import {
  DecafAuthModule,
  DecafExceptionFilter,
  DecafModule,
  DecafStreamModule,
} from "@decaf-ts/for-nest";
import { Metadata, DecorationKeys, uses } from "@decaf-ts/decoration";
import {
  KeycloakAuthService,
  KeycloakService,
  type KeycloakSetupConfig,
  type KeycloakUser,
} from "../../src/keycloak";
import {
  extractKeycloakRoles,
  getRealmFromIssuer,
  getTokenPayload,
} from "../../src/nest/utils";

RamAdapter.decoration();
NanoAdapter.decoration();
Metadata.set(DecorationKeys.FLAVOUR, RamFlavour, []);
Metadata.set(DecorationKeys.FLAVOUR, NanoFlavour, []);
Model.setBuilder(Model.fromModel);
Adapter.setCurrent(RamFlavour);

jest.setTimeout(240000);

const KEYCLOAK_HOST = process.env.KEYCLOAK_HOST || "localhost:8180";
const KEYCLOAK_PROTOCOL =
  (process.env.KEYCLOAK_PROTOCOL as "http" | "https") || "http";
const KEYCLOAK_REALM = `for-nest-fabric-suite-${Math.random()
  .toString(36)
  .slice(2, 10)}`;
const KEYCLOAK_CLIENT_ID = "for-nest-fabric-suite-client";
const KEYCLOAK_CLIENT_SECRET =
  process.env.KEYCLOAK_CLIENT_SECRET || "for-nest-fabric-suite-secret";
const KEYCLOAK_ADMIN_USER = process.env.KEYCLOAK_ADMIN_USER || "admin";
const KEYCLOAK_ADMIN_PASSWORD = process.env.KEYCLOAK_ADMIN_PASSWORD || "admin";

class KeycloakRequestTransformer implements RequestToContextTransformer<any> {
  async from(ctx: any): Promise<any> {
    const user = ctx.getOrUndefined?.("user");
    return {
      headers: ctx.getOrUndefined?.("headers") || {},
      user,
      UUID: user,
      overrides: {},
    };
  }
}

requestToContextTransformer("nano")(KeycloakRequestTransformer);

type EventRecord = [string, string, string, any];

function randomSuffix() {
  return `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function principal(username: string) {
  return `${username}@example.com`;
}

async function waitFor<T>(
  condition: () => Promise<T | false | undefined> | T | false | undefined,
  timeoutMs = 15000,
  intervalMs = 100
): Promise<T> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const value = await condition();
    if (value) return value as T;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  throw new InternalError(`Timed out after ${timeoutMs}ms waiting for condition`);
}

async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  label: string
) {
  let timeout: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timeout = setTimeout(
          () =>
            reject(new InternalError(`Timed out waiting for ${label}`)),
          timeoutMs
        );
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

async function waitForNanoAccess(
  dbName: string,
  user: string,
  password: string,
  host: string,
  protocol: "http" | "https",
  timeoutMs = 15000,
  intervalMs = 250
) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const probe = NanoAdapter.connect(user, password, host, protocol);
    try {
      await probe.db.use(dbName).get("_security");
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    } finally {
      NanoAdapter.closeConnection(probe);
    }
  }
  throw new InternalError(
    `Timed out waiting for Nano access to ${dbName} as ${user}`
  );
}

async function createNanoTestResources(prefix: string) {
  const adminUser = process.env.NANO_ADMIN_USER || "couchdb.admin";
  const adminPassword = process.env.NANO_ADMIN_PASSWORD || "couchdb.admin";
  const dbHost = process.env.NANO_HOST || "localhost:10010";
  const dbProtocol = (process.env.NANO_PROTOCOL as "http" | "https") || "http";

  const suffix = randomSuffix();
  const dbName = `${prefix}_${suffix}`;
  const user = `${prefix}_user_${suffix}`;
  const password = `${user}_pw`;
  const connection = NanoAdapter.connect(
    adminUser,
    adminPassword,
    dbHost,
    dbProtocol
  );

  await NanoAdapter.createDatabase(connection, dbName).catch((e: any) => {
    if (!(e instanceof Error) || (e as any).error !== "file_exists") {
      throw new InternalError(String(e));
    }
  });
  await NanoAdapter.createUser(connection, dbName, user, password).catch(
    (e: any) => {
      if (!(e instanceof Error) || (e as any).error !== "file_exists") {
        throw new InternalError(String(e));
      }
    }
  );
  await waitForNanoAccess(dbName, user, password, dbHost, dbProtocol);

  return {
    connection,
    dbName,
    user,
    password,
    host: dbHost,
    protocol: dbProtocol,
  };
}

async function createRealmRole(
  realm: string,
  token: string,
  roleName: string
) {
  const response = await fetch(
    `http://${KEYCLOAK_HOST}/admin/realms/${realm}/roles`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        name: roleName,
      }),
    }
  );

  if (!response.ok && response.status !== 409) {
    throw new InternalError(
      `Failed to create role ${roleName}: ${response.status} ${await response.text()}`
    );
  }
}

async function createClient(
  realm: string,
  token: string,
  client: { clientId: string; clientName: string; secret: string }
) {
  const response = await fetch(
    `http://${KEYCLOAK_HOST}/admin/realms/${realm}/clients`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        clientId: client.clientId,
        name: client.clientName,
        enabled: true,
        clientAuthenticatorType: "client-secret",
        secret: client.secret,
        publicClient: true,
        standardFlowEnabled: true,
        directAccessGrantsEnabled: true,
        serviceAccountsEnabled: false,
        authorizationServicesEnabled: false,
        redirectUris: ["http://localhost/*"],
        webOrigins: ["http://localhost"],
      }),
    }
  );

  if (!response.ok && response.status !== 409) {
    throw new InternalError(
      `Failed to create client ${client.clientId}: ${response.status} ${await response.text()}`
    );
  }
}

async function cleanupNanoTestResources(resources: Awaited<
  ReturnType<typeof createNanoTestResources>
>) {
  const { connection, dbName, user } = resources;
  try {
    await NanoAdapter.deleteDatabase(connection, dbName);
  } catch (e: any) {
    if (!(e instanceof Error)) throw new InternalError(String(e));
  }
  try {
    await NanoAdapter.deleteUser(connection, dbName, user);
  } catch (e: any) {
    if (!(e instanceof Error)) throw new InternalError(String(e));
  } finally {
    NanoAdapter.closeConnection(connection);
  }
}

function asRepoWithToken<T extends Model>(
  repo: RestService<T, any, any>,
  token: string
) {
  const authAdapter = new Proxy(repo.adapter, {
    get: (target, prop, receiver) => {
      if (prop === "request") {
        return (details: any, ...args: any[]) =>
          (target as any).request.call(
            target,
            {
              ...details,
              headers: {
                ...(details?.headers || {}),
                Authorization: `Bearer ${token}`,
              },
            },
            ...args
          );
      }
      return Reflect.get(target, prop, receiver);
    },
  });

  const scopedRepo = Object.create(Object.getPrototypeOf(repo));
  Object.assign(scopedRepo, repo);
  scopedRepo._adapter = authAdapter;
  return scopedRepo as RestService<T, any, any>;
}

function assertValidModel<T extends Model>(model: T, ctor: new (...args: any[]) => T) {
  expect(model).toBeInstanceOf(ctor);
  expect(model.hasErrors()).toBeUndefined();
}

@uses(RamFlavour)
@table("fabric_product")
@roles(["fabric-product-writer"])
@model()
class FabricProduct extends Model {
  @pk({ type: String, generated: false })
  @defaultQueryAttr()
  productCode!: string;

  @defaultQueryAttr()
  @column()
  @required()
  inventedName!: string;

  @column()
  @required()
  nameMedicinalProduct!: string;

  @column()
  internalMaterialCode?: string;

  @column()
  productRecall: boolean = false;

  @column()
  @createdBy()
  createdBy!: string;

  @column()
  @updatedBy()
  updatedBy!: string;

  @column()
  @createdAt()
  createdAt!: Date;

  @column()
  @updatedAt()
  updatedAt!: Date;

  constructor(arg?: ModelArg<FabricProduct>) {
    super(arg);
  }
}

@uses(NanoFlavour)
@table("fabric_batch")
@roles(["fabric-batch-reader"])
@model()
class FabricBatch extends Model {
  @pk({ type: String, generated: false })
  @composed(["productCode", "batchNumber"], ":")
  id!: string;

  @defaultQueryAttr()
  @column()
  @required()
  productCode!: string;

  @defaultQueryAttr()
  @column()
  @required()
  batchNumber!: string;

  @column()
  @required()
  expiryDate!: string;

  @column()
  manufacturerName?: string;

  @column()
  @createdBy()
  createdBy!: string;

  @column()
  @updatedBy()
  updatedBy!: string;

  @column()
  @createdAt()
  createdAt!: Date;

  @column()
  @updatedAt()
  updatedAt!: Date;

  constructor(arg?: ModelArg<FabricBatch>) {
    super(arg);
  }
}

class KeycloakSuiteAuthHandler extends AuthHandler<any, any, any> {
  protected override async extractFromAuth(ctx: any) {
    const request = ctx.switchToHttp().getRequest<any>();
    const token = getBearerToken(request?.headers?.authorization);
    if (!token) {
      throw new AuthorizationError("Token not found");
    }

    const payload = getTokenPayload(token);
    if (!payload) {
      throw new AuthorizationError("Invalid token");
    }
    const user = payload?.email ?? payload?.preferred_username;
    const roles = extractKeycloakRoles(payload);

    return {
      user,
      organization: getRealmFromIssuer(token),
      roles,
    };
  }
}

function getBearerToken(header?: string): string | undefined {
  if (!header) return undefined;
  return header.startsWith("Bearer ") ? header.slice("Bearer ".length) : header;
}

describe("Keycloak-backed fabric model suite", () => {
  let app: INestApplication;
  let adapter: AxiosHttpAdapter;
  let nanoResources: Awaited<ReturnType<typeof createNanoTestResources>>;
  let keycloakService: KeycloakService;
  let keycloakAuthService: KeycloakAuthService;
  let setup: KeycloakSetupConfig;
  let productToken: string;
  let batchToken: string;
  let adminToken: string;
  let observerToken: string;
  let productRepo: RestService<FabricProduct, any, any>;
  let batchRepo: RestService<FabricBatch, any, any>;

  const users: Record<
    string,
    KeycloakUser & { roles: string[] }
  > = {
    product: {
      realm: KEYCLOAK_REALM,
      apiClientId: KEYCLOAK_CLIENT_ID,
      username: `fabric-product-${randomSuffix()}`,
      password: `FabricProduct123!${randomSuffix()}`,
      roles: ["fabric-product-writer"],
    },
    batch: {
      realm: KEYCLOAK_REALM,
      apiClientId: KEYCLOAK_CLIENT_ID,
      username: `fabric-batch-${randomSuffix()}`,
      password: `FabricBatch123!${randomSuffix()}`,
      roles: ["fabric-batch-reader"],
    },
    admin: {
      realm: KEYCLOAK_REALM,
      apiClientId: KEYCLOAK_CLIENT_ID,
      username: `fabric-admin-${randomSuffix()}`,
      password: `FabricAdmin123!${randomSuffix()}`,
      roles: [
        "fabric-product-writer",
        "fabric-batch-reader",
        "fabric-audit-admin",
      ],
    },
  };

  beforeAll(async () => {
    nanoResources = await createNanoTestResources("keycloak-fabric-suite");

    setup = {
      id: "keycloak-fabric-suite",
      host: KEYCLOAK_HOST,
      protocol: KEYCLOAK_PROTOCOL,
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
        clientId: KEYCLOAK_CLIENT_ID,
        secret: KEYCLOAK_CLIENT_SECRET,
        clientName: "for-nest-fabric-suite",
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
      await keycloakService.deleteOrganization(KEYCLOAK_REALM);
    } catch {
      // Realm may not exist on a clean run.
    }
    await keycloakService.addRealm(KEYCLOAK_REALM, {});
    await new Promise((resolve) => setTimeout(resolve, 1000));

    const productUuid = await keycloakService.addUserToRealm(
      users.product,
      {
        enabled: true,
        emailVerified: true,
        firstName: "Fabric",
        lastName: "Product",
        email: `${users.product.username}@example.com`,
      }
    );
    const batchUuid = await keycloakService.addUserToRealm(
      users.batch,
      {
        enabled: true,
        emailVerified: true,
        firstName: "Fabric",
        lastName: "Batch",
        email: `${users.batch.username}@example.com`,
      }
    );
    const adminUuid = await keycloakService.addUserToRealm(
      users.admin,
      {
        enabled: true,
        emailVerified: true,
        firstName: "Fabric",
        lastName: "Admin",
        email: `${users.admin.username}@example.com`,
      }
    );

    keycloakAuthService = new KeycloakAuthService();
    await keycloakAuthService.initialize(setup);
    const masterToken = await keycloakAuthService.getAccessToken(
      setup.adminApiUser!
    );
    await createRealmRole(KEYCLOAK_REALM, masterToken, "fabric-product-writer");
    await createRealmRole(KEYCLOAK_REALM, masterToken, "fabric-batch-reader");
    await createRealmRole(KEYCLOAK_REALM, masterToken, "fabric-audit-admin");
    await createClient(KEYCLOAK_REALM, masterToken, {
      clientId: KEYCLOAK_CLIENT_ID,
      clientName: "for-nest-fabric-suite",
      secret: KEYCLOAK_CLIENT_SECRET,
    });

    await Promise.all([
      keycloakService.addRealmRolesToUser(
        KEYCLOAK_REALM,
        productUuid,
        users.product.roles
      ),
      keycloakService.addRealmRolesToUser(
        KEYCLOAK_REALM,
        batchUuid,
        users.batch.roles
      ),
      keycloakService.addRealmRolesToUser(
        KEYCLOAK_REALM,
        adminUuid,
        users.admin.roles
      ),
    ]);
    productToken = await keycloakAuthService.getAccessToken(users.product);
    batchToken = await keycloakAuthService.getAccessToken(users.batch);
    adminToken = await keycloakAuthService.getAccessToken(users.admin);
    observerToken = adminToken;

    const moduleRef = await Test.createTestingModule({
      imports: [
        DecafAuthModule.forRoot({ global: true, handler: KeycloakSuiteAuthHandler }),
        await DecafModule.forRootAsync({
          conf: [
            [RamAdapter, { UUID: "bootstrap" }, new RamTransformer()],
            [
              NanoAdapter,
              {
                couchUser: nanoResources.user,
                couchPassword: nanoResources.password,
                host: nanoResources.host,
                dbName: nanoResources.dbName,
                protocol: nanoResources.protocol,
              },
              nanoResources.dbName,
              new KeycloakRequestTransformer(),
            ],
          ],
          autoControllers: true,
          autoServices: true,
        } as any),
        DecafStreamModule.forFlavours([RamFlavour, NanoFlavour], "/sse"),
      ],
      providers: [KeycloakSuiteAuthHandler],
    }).compile();

    app = moduleRef.createNestApplication();
    app.useGlobalFilters(new DecafExceptionFilter());
    await app.init();

    const server = await app.listen(0);
    const address = server.address();
    if (!address || typeof address === "string") {
      throw new InternalError("Failed to resolve server address");
    }

    const host =
      address.address === "::"
        ? `127.0.0.1:${address.port}`
        : `${address.address}:${address.port}`;

    adapter = new AxiosHttpAdapter({
      protocol: "http",
      host,
      eventsListenerPath: "sse",
      eventHeaderResolver: async () => ({
        Authorization: `Bearer ${observerToken}`,
      }),
    });
    await adapter.initialize();
    const parseResponse = adapter.parseResponse.bind(adapter);
    (adapter as any).parseResponse = function (
      clazz: any,
      method: any,
      res: any
    ) {
      if (res?.status >= 400) {
        console.error(
          "HTTP error response",
          method,
          res.status,
          res.data ?? res.body ?? res.error
        );
      }
      return parseResponse(clazz, method, res);
    };

    productRepo = new RestService(adapter, FabricProduct);
    batchRepo = new RestService(adapter, FabricBatch);
  });

  afterAll(async () => {
    await withTimeout(app?.close() ?? Promise.resolve(), 30000, "Nest app shutdown");
    try {
      await withTimeout(
        keycloakService?.deleteOrganization(KEYCLOAK_REALM) ?? Promise.resolve(),
        20000,
        `delete realm ${KEYCLOAK_REALM}`
      );
    } catch {
      // ignore cleanup errors
    }
    await withTimeout(
      cleanupNanoTestResources(nanoResources),
      20000,
      `cleanup nano resources ${nanoResources?.dbName}`
    );
  });

  beforeEach(async () => {
    // Each test creates and deletes its own data in this isolated realm.
  });

  describe("auth and CRUD", () => {
    it("creates, reads, updates and deletes ram models with createdBy/updatedBy set from Keycloak", async () => {
      const repo = asRepoWithToken(productRepo, productToken);
      const adminRepo = asRepoWithToken(productRepo, adminToken);
      const seed = new FabricProduct({
        productCode: `gtin-${randomSuffix()}`,
        inventedName: "Fabric Product",
        nameMedicinalProduct: "Medicinal Product",
        internalMaterialCode: "mat-1",
        productRecall: false,
      });

      const created = await withTimeout(
        repo.create(seed),
        20000,
        `create ram model ${seed.productCode}`
      );
      assertValidModel(created, FabricProduct);
      expect(created.productCode).toBe(seed.productCode);
      expect(created.createdBy).toBe(principal(users.product.username));
      expect(created.updatedBy).toBe(principal(users.product.username));
      expect(created.hasErrors()).toBeUndefined();

      const read = await repo.read(created.productCode);
      assertValidModel(read, FabricProduct);
      expect(read.createdBy).toBe(principal(users.product.username));
      expect(read.updatedBy).toBe(principal(users.product.username));

      const updated = await adminRepo.update(
        new FabricProduct({
          ...read,
          inventedName: "Fabric Product Updated",
        })
      );
      assertValidModel(updated, FabricProduct);
      expect(updated.inventedName).toBe("Fabric Product Updated");
      expect(updated.createdBy).toBe(principal(users.product.username));
      expect(updated.updatedBy).toBe(principal(users.admin.username));

      const deleted = await adminRepo.delete(updated.productCode);
      expect(deleted).toBeDefined();
      await expect(repo.read(updated.productCode)).rejects.toThrow();
    });

    it("creates, reads, updates and deletes nano models with createdBy/updatedBy set from Keycloak", async () => {
      const repo = asRepoWithToken(batchRepo, batchToken);
      const adminRepo = asRepoWithToken(batchRepo, adminToken);
      const seed = new FabricBatch({
        productCode: `gtin-${randomSuffix()}`,
        batchNumber: `batch-${randomSuffix()}`,
        expiryDate: "2030-12-31",
        manufacturerName: "Batch Maker",
      });

      const created = await withTimeout(
        repo.create(seed),
        20000,
        `create nano model ${seed.id}`
      );
      assertValidModel(created, FabricBatch);
      expect(created.id).toBe(`${seed.productCode}:${seed.batchNumber}`);
      expect(created.createdBy).toBe(principal(users.batch.username));
      expect(created.updatedBy).toBe(principal(users.batch.username));

      const read = await repo.read(created.id);
      assertValidModel(read, FabricBatch);

      const updated = await adminRepo.update(
        new FabricBatch({
          ...read,
          manufacturerName: "Batch Maker Updated",
        })
      );
      assertValidModel(updated, FabricBatch);
      expect(updated.manufacturerName).toBe("Batch Maker Updated");
      expect(updated.createdBy).toBe(principal(users.batch.username));
      expect(updated.updatedBy).toBe(principal(users.admin.username));

      const deleted = await adminRepo.delete(updated.id);
      expect(deleted).toBeDefined();
      await expect(repo.read(updated.id)).rejects.toThrow();
    });
  });

  describe("bulk, query and statement", () => {
    it("validates the full repository surface for ram models", async () => {
      const repo = asRepoWithToken(productRepo, adminToken);
      const seeds = [
        new FabricProduct({
          productCode: `gtin-${randomSuffix()}`,
          inventedName: "Fabric Query A",
          nameMedicinalProduct: "Medicinal A",
          productRecall: false,
        }),
        new FabricProduct({
          productCode: `gtin-${randomSuffix()}`,
          inventedName: "Fabric Query B",
          nameMedicinalProduct: "Medicinal B",
          productRecall: false,
        }),
      ];

      const created = await repo.createAll(seeds);
      expect(created).toHaveLength(2);
      created.forEach((item) => {
        assertValidModel(item, FabricProduct);
        expect(item.createdBy).toBe(principal(users.admin.username));
        expect(item.updatedBy).toBe(principal(users.admin.username));
      });

      const read = await repo.readAll(created.map((item) => item.productCode));
      expect(read).toHaveLength(2);
      read.forEach((item) => {
        assertValidModel(item, FabricProduct);
      });

      const updated = await repo.updateAll(
        read.map(
          (item, idx) =>
            new FabricProduct({
              ...item,
              inventedName: `${item.inventedName} ${idx}`,
            })
        )
      );
      expect(updated).toHaveLength(2);
      updated.forEach((item) => {
        assertValidModel(item, FabricProduct);
        expect(item.updatedBy).toBe(principal(users.admin.username));
      });

      const listBy = await repo.listBy("inventedName", OrderDirection.ASC);
      expect(listBy.length).toBeGreaterThanOrEqual(2);
      listBy.forEach((item) => assertValidModel(item, FabricProduct));

      const findBy = await repo.findBy("inventedName", "Fabric Query A");
      expect(findBy.length).toBeGreaterThanOrEqual(1);
      findBy.forEach((item) => assertValidModel(item, FabricProduct));

      const statementFindBy = await repo.statement(
        "findBy",
        "inventedName",
        "Fabric Query A",
        {},
        { direction: OrderDirection.ASC }
      );
      expect(statementFindBy.length).toBeGreaterThanOrEqual(1);
      statementFindBy.forEach((item: FabricProduct) =>
        assertValidModel(item, FabricProduct)
      );

      const page = await repo.page("Fabric Query", OrderDirection.ASC, {
        offset: 1,
        limit: 1,
      });
      expect(page.data.length).toBe(1);
      page.data.forEach((item) => assertValidModel(item, FabricProduct));

      const paginateBy = await repo.paginateBy(
        "inventedName",
        OrderDirection.ASC,
        {
          offset: 1,
          limit: 1,
        }
      );
      expect(paginateBy.data.length).toBe(1);

      const deleteAll = await repo.deleteAll(
        updated.map((item) => item.productCode)
      );
      expect(deleteAll).toHaveLength(2);
    });

    it("validates the full repository surface for nano models", async () => {
      const repo = asRepoWithToken(batchRepo, adminToken);
      const seeds = [
        new FabricBatch({
          productCode: `gtin-${randomSuffix()}`,
          batchNumber: `batch-a`,
          expiryDate: "2030-12-31",
          manufacturerName: "Nano A",
        }),
        new FabricBatch({
          productCode: `gtin-${randomSuffix()}`,
          batchNumber: `batch-b`,
          expiryDate: "2030-12-31",
          manufacturerName: "Nano B",
        }),
      ];

      const created = await repo.createAll(seeds);
      expect(created).toHaveLength(2);
      created.forEach((item) => assertValidModel(item, FabricBatch));

      const read = await repo.readAll(created.map((item) => item.id));
      expect(read).toHaveLength(2);
      read.forEach((item) => assertValidModel(item, FabricBatch));

      const updated = await repo.updateAll(
        read.map(
          (item, idx) =>
            new FabricBatch({
              ...item,
              manufacturerName: `${item.manufacturerName} ${idx}`,
            })
        )
      );
      expect(updated).toHaveLength(2);
      updated.forEach((item) => assertValidModel(item, FabricBatch));

      const findBy = await repo.findBy("productCode", created[0].productCode);
      expect(findBy.length).toBeGreaterThanOrEqual(1);
      findBy.forEach((item) => assertValidModel(item, FabricBatch));

      const statementFindOneBy = await repo.statement(
        "findOneBy",
        "productCode",
        created[0].productCode,
        {}
      );
      assertValidModel(statementFindOneBy, FabricBatch);

      const page = await repo.page("batch", OrderDirection.ASC, {
        offset: 1,
        limit: 1,
      });
      expect(page.data.length).toBe(1);
      page.data.forEach((item) => assertValidModel(item, FabricBatch));

      const deleteAll = await repo.deleteAll(
        updated.map((item) => item.id)
      );
      expect(deleteAll).toHaveLength(2);
    });

    it("returns decaf errors for unauthorized tokens", async () => {
      const writerRepo = asRepoWithToken(batchRepo, productToken);
      await expect(
        writerRepo.create(
          new FabricBatch({
            productCode: `gtin-${randomSuffix()}`,
            batchNumber: `batch-denied`,
            expiryDate: "2030-12-31",
          })
        )
      ).rejects.toThrow(InternalError);
    });
  });

  describe("sse observers", () => {
    function observe(
      repo: RestService<any, any, any>,
      expectedCount: number
    ): { events: Promise<EventRecord[]>; close: () => void } {
      const events: EventRecord[] = [];
      const observer: Observer = {
        refresh(model: any, operation: string, id: string, payload: any) {
          events.push([model?.name ?? String(model), operation, String(id), payload]);
          if (events.length >= expectedCount) {
            return Promise.resolve();
          }
          return Promise.resolve();
        },
      };
      const close = repo.observe(observer);
      return {
        events: new Promise((resolve, reject) => {
          const timeout = setTimeout(() => {
            close();
            reject(
              new InternalError(
                `Timed out waiting for ${expectedCount} SSE events, got ${events.length}`
              )
            );
          }, 20000);

          const interval = setInterval(() => {
            if (events.length >= expectedCount) {
              clearTimeout(timeout);
              clearInterval(interval);
              close();
              resolve(events.slice());
            }
          }, 25);
        }),
        close,
      };
    }

    it("streams one copy of each event to multiple concurrent clients", async () => {
      const clientA = observe(asRepoWithToken(productRepo, observerToken), 3);
      const clientB = observe(asRepoWithToken(productRepo, observerToken), 3);
      const clientC = observe(asRepoWithToken(productRepo, observerToken), 3);

      await waitFor(
        () => Boolean((adapter as any).dispatch?.listening),
        10000
      );

      const repo = asRepoWithToken(productRepo, adminToken);
      const seed = new FabricProduct({
        productCode: `gtin-${randomSuffix()}`,
        inventedName: "Fabric SSE",
        nameMedicinalProduct: "SSE Medicinal",
      });
      const created = await withTimeout(
        repo.create(seed),
        20000,
        `create SSE seed ${seed.productCode}`
      );
      const updated = await repo.update(
        new FabricProduct({
          ...created,
          inventedName: "Fabric SSE Updated",
        })
      );
      await repo.delete(updated.productCode);

      const [eventsA, eventsB, eventsC] = await Promise.all([
        clientA.events,
        clientB.events,
        clientC.events,
      ]);

      for (const events of [eventsA, eventsB, eventsC]) {
        expect(events).toHaveLength(3);
        expect(events.map((entry) => entry[0])).toEqual([
          FabricProduct.name,
          FabricProduct.name,
          FabricProduct.name,
        ]);
        expect(events.map((entry) => entry[1])).toEqual([
          OperationKeys.CREATE,
          OperationKeys.UPDATE,
          OperationKeys.DELETE,
        ]);
        expect(new Set(events.map((entry) => entry[2])).size).toBe(1);
        expect(events[0][3].createdBy).toBe(principal(users.admin.username));
      }
    });

    it("streams ram and nano events through the same adapter connection", async () => {
      const ramObserver = observe(asRepoWithToken(productRepo, observerToken), 1);
      const nanoObserver = observe(asRepoWithToken(batchRepo, observerToken), 1);

      await waitFor(
        () => Boolean((adapter as any).dispatch?.listening),
        10000
      );

      const product = await withTimeout(
        asRepoWithToken(productRepo, adminToken).create(
          new FabricProduct({
            productCode: `gtin-${randomSuffix()}`,
            inventedName: "Ram SSE",
            nameMedicinalProduct: "Ram Medicinal",
          })
        ),
        20000,
        "create ram SSE event"
      );
      const batch = await withTimeout(
        asRepoWithToken(batchRepo, adminToken).create(
          new FabricBatch({
            productCode: `gtin-${randomSuffix()}`,
            batchNumber: "sse-batch",
            expiryDate: "2030-12-31",
          })
        ),
        20000,
        "create nano SSE event"
      );

      const [ramEvents, nanoEvents] = await Promise.all([
        ramObserver.events,
        nanoObserver.events,
      ]);

      expect(ramEvents[0][0]).toBe(FabricProduct.name);
      expect(nanoEvents[0][0]).toBe(FabricBatch.name);
      expect(ramEvents[0][1]).toBe(OperationKeys.CREATE);
      expect(nanoEvents[0][1]).toBe(OperationKeys.CREATE);

      await asRepoWithToken(productRepo, adminToken).delete(product.productCode);
      await asRepoWithToken(batchRepo, adminToken).delete(batch.id);
    });
  });
});
