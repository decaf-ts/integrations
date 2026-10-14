import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { pathToFileURL } from "url";

import { ValidationError } from "@decaf-ts/db-decorators";

import {
  AdapterObjectLoader,
  AngularComponentObjectLoader,
  assertConstructor,
  ControllerObjectLoader,
  EnvironmentObjectLoader,
  ModelObjectLoader,
  RepositoryObjectLoader,
  ServiceObjectLoader,
} from "../../../src/loader";

const fixtureSource = `
export class DefaultThing {
  static marker = "default";
}

export class NamedThing {
  static marker = "named";
}

export const plainThing = {
  label: "plain",
};

export default DefaultThing;
`;

describe("ObjectLoader family wrappers", () => {
  let tempDir: string;
  let fixturePath: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "decaf-object-loader-families-"));
    fixturePath = join(tempDir, "fixture.mjs");
    writeFileSync(fixturePath, fixtureSource, "utf8");
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("loadModel resolves the constructor reference and runs hooks", async () => {
    const namespace = (await import(pathToFileURL(fixturePath).href)) as {
      NamedThing: unknown;
    };
    let hookValue: unknown;
    const loader = new ModelObjectLoader({
      hooks: [
        (value) => {
          hookValue = value;
          return value;
        },
      ],
    });

    const loaded = await loader.loadModel(fixturePath, "NamedThing");
    expect(loader.family).toBe("model");
    expect(loaded).toBe(namespace.NamedThing);
    expect(hookValue).toBe(namespace.NamedThing);
  });

  it("loadService resolves the constructor reference", async () => {
    const namespace = (await import(pathToFileURL(fixturePath).href)) as {
      default: unknown;
    };
    const loader = new ServiceObjectLoader();

    expect(loader.family).toBe("service");
    expect(await loader.loadService(fixturePath)).toBe(namespace.default);
  });

  it.each([
    [ModelObjectLoader, "model", "loadModel"],
    [ServiceObjectLoader, "service", "loadService"],
  ] as const)(
    "%s rejects a non-constructor export with a decaf ValidationError",
    async (LoaderClass, family, methodName) => {
      const loader = new LoaderClass();
      const loaderAsRecord = loader as unknown as Record<
        string,
        (source: string, exportName?: string) => Promise<unknown>
      >;

      expect(loader.family).toBe(family);
      await expect(
        loaderAsRecord[methodName](fixturePath, "plainThing")
      ).rejects.toBeInstanceOf(ValidationError);
    }
  );

  it.each([
    [AdapterObjectLoader, "adapter", "loadAdapter"],
    [RepositoryObjectLoader, "repository", "loadRepository"],
    [ControllerObjectLoader, "controller", "loadController"],
    [EnvironmentObjectLoader, "environment", "loadEnvironment"],
    [AngularComponentObjectLoader, "component", "loadComponent"],
  ] as const)(
    "%s exposes %s family and loads the requested export",
    async (LoaderClass, family, methodName) => {
      const namespace = (await import(
        pathToFileURL(fixturePath).href
      )) as {
        NamedThing: unknown;
      };
      const loader = new LoaderClass();
      const loaderAsRecord = loader as unknown as Record<
        string,
        (source: string, exportName?: string) => Promise<unknown>
      >;

      expect(loader.family).toBe(family);
      expect(typeof loaderAsRecord[methodName]).toBe("function");
      expect(await loaderAsRecord[methodName](fixturePath, "NamedThing")).toBe(
        namespace.NamedThing
      );
    }
  );

  it("assertConstructor returns functions and rejects non-functions", () => {
    class Example {}
    expect(assertConstructor(Example, "model", "src", "Example")).toBe(Example);
    expect(() =>
      assertConstructor({ label: "plain" }, "model", "src", "plainThing")
    ).toThrow(ValidationError);
  });
});
