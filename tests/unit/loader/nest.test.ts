import "reflect-metadata";

import { ValidationError } from "@decaf-ts/db-decorators";

import {
  NestControllerObjectLoader,
  NestRouteObjectLoader,
} from "../../../src/loader";

const fixtureHref = new URL(
  "./fixtures/nest-app.fixture.mjs",
  import.meta.url
).href;

type FixtureModule = {
  UsersController: new () => unknown;
  HealthController: new () => unknown;
  FeatureModule: new () => unknown;
  AppModule: new () => unknown;
  PlainClass: new () => unknown;
  plainThing: { label: string };
  default: new () => unknown;
};

const loadFixture = async (): Promise<FixtureModule> =>
  (await import(fixtureHref)) as FixtureModule;

describe("NestControllerObjectLoader", () => {
  it("loadController resolves a decorated @Controller class", async () => {
    const fixture = await loadFixture();
    const loader = new NestControllerObjectLoader();

    const loaded = await loader.loadController(fixtureHref);
    expect(loader.family).toBe("controller");
    expect(loaded).toBe(fixture.UsersController);
    expect(loader.isController(loaded)).toBe(true);
    expect(loader.getControllerPath(loaded)).toBe("users");
  });

  it("loadController rejects a non-controller export with a decaf ValidationError", async () => {
    const loader = new NestControllerObjectLoader();

    await expect(
      loader.loadController(fixtureHref, "plainThing")
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("collectControllers finds exported controllers and recurses into imports", async () => {
    const fixture = await loadFixture();
    const loader = new NestControllerObjectLoader();

    const controllers = loader.collectControllers(fixture);
    expect(controllers).toEqual(
      expect.arrayContaining([fixture.UsersController, fixture.HealthController])
    );
    expect(controllers).not.toContain(fixture.PlainClass);
  });

  it("collectControllers scans a plain module descriptor's controllers and imports", async () => {
    const fixture = await loadFixture();
    const loader = new NestControllerObjectLoader();
    const inner = { controllers: [fixture.HealthController] };
    const outer = {
      controllers: [fixture.UsersController],
      imports: [inner],
    };

    const recursive = loader.collectControllers(outer);
    expect(recursive).toEqual(
      expect.arrayContaining([fixture.UsersController, fixture.HealthController])
    );

    const shallow = loader.collectControllers(outer, false);
    expect(shallow).toContain(fixture.UsersController);
    expect(shallow).not.toContain(fixture.HealthController);
  });

  it("loadControllers runs hooks against the resolved array", async () => {
    const fixture = await loadFixture();
    let seen: unknown[] = [];
    let metadata: Readonly<Record<string, unknown>> | undefined;
    const loader = new NestControllerObjectLoader({
      hooks: [
        (value, context) => {
          seen = value as unknown[];
          metadata = context.metadata;
          return [...(value as unknown[]), "marker"];
        },
      ],
    });

    const controllers = await loader.loadControllers(fixtureHref);
    expect(seen).toEqual(
      expect.arrayContaining([fixture.UsersController, fixture.HealthController])
    );
    expect(controllers).toContain("marker");
    expect(metadata).toMatchObject({ controllerCount: 2 });
  });
});

describe("NestRouteObjectLoader", () => {
  it("getRoutes returns route definitions with method, path and fullPath", async () => {
    const fixture = await loadFixture();
    const loader = new NestRouteObjectLoader();
    const routes = loader.getRoutes(fixture.UsersController);

    expect(loader.family).toBe("route");
    expect(routes).toHaveLength(2);

    const find = routes.find((route) => route.propertyKey === "find");
    expect(find).toMatchObject({
      controller: fixture.UsersController,
      controllerName: "UsersController",
      controllerPath: "users",
      method: 0,
      methodName: "GET",
      path: ":id",
      fullPath: "/users/:id",
    });
    expect(typeof find?.handler).toBe("function");

    const create = routes.find((route) => route.propertyKey === "create");
    expect(create).toMatchObject({
      method: 1,
      methodName: "POST",
      path: "/",
      fullPath: "/users",
    });
  });

  it("getRoutes accepts an explicit controller path", async () => {
    const fixture = await loadFixture();
    const loader = new NestRouteObjectLoader();
    const routes = loader.getRoutes(fixture.UsersController, "api");

    expect(routes.find((route) => route.propertyKey === "find")).toMatchObject({
      controllerPath: "api",
      fullPath: "/api/:id",
    });
  });

  it("getRoutes returns no routes for a plain class", async () => {
    const fixture = await loadFixture();
    const loader = new NestRouteObjectLoader();

    expect(loader.getRoutes(fixture.PlainClass)).toEqual([]);
  });

  it("loadControllerRoutes resolves routes for an exported controller", async () => {
    let hookRoutes: unknown[] = [];
    const loader = new NestRouteObjectLoader({
      hooks: [
        (value) => {
          hookRoutes = value as unknown[];
          return value;
        },
      ],
    });

    const routes = await loader.loadControllerRoutes(fixtureHref);
    expect(routes.map((route) => route.fullPath)).toEqual([
      "/users/:id",
      "/users",
    ]);
    expect(hookRoutes).toBe(routes);
  });

  it("loadControllerRoutes rejects a non-controller export", async () => {
    const loader = new NestRouteObjectLoader();

    await expect(
      loader.loadControllerRoutes(fixtureHref, "plainThing")
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("loadRoutes resolves routes for every controller in a module", async () => {
    const loader = new NestRouteObjectLoader();

    const routes = await loader.loadRoutes(fixtureHref);
    const fullPaths = routes.map((route) => route.fullPath);

    expect(fullPaths).toEqual(
      expect.arrayContaining(["/users/:id", "/users", "/health"])
    );
  });
});
