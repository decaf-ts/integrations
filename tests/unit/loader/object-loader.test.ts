import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { pathToFileURL } from "url";

import {
  AdapterObjectLoader,
  AngularComponentObjectLoader,
  ControllerObjectLoader,
  EnvironmentObjectLoader,
  GraphNodeObjectLoader,
  ModelObjectLoader,
  ObjectLoader,
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
  steps: [],
};

export default DefaultThing;
`;

describe("ObjectLoader", () => {
  let tempDir: string;
  let fixturePath: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "decaf-object-loader-"));
    fixturePath = join(tempDir, "fixture.mjs");
    writeFileSync(fixturePath, fixtureSource, "utf8");
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("loads default and named exports from a file path without changing references", async () => {
    const namespace = (await import(pathToFileURL(fixturePath).href)) as {
      default: unknown;
      NamedThing: unknown;
      plainThing: { label: string; steps: string[] };
    };
    const loader = new ObjectLoader();

    const defaultThing = await loader.loadDefault(fixturePath);
    const namedThing = await loader.loadExport(fixturePath, "NamedThing");

    expect(defaultThing).toBe(namespace.default);
    expect(namedThing).toBe(namespace.NamedThing);
    expect(await loader.loadModule(fixturePath)).toHaveProperty("plainThing");
  });

  it("runs base and call-specific hooks in order", async () => {
    const seen: string[] = [];
    const loader = new ObjectLoader({
      family: "service",
      hooks: [
        (value, context) => {
          seen.push(`${context.family}:${context.exportName}:base`);
          return {
            ...(value as Record<string, unknown>),
            steps: ["base"],
          };
        },
      ],
    });

    const result = await loader.loadExport<{
      label: string;
      steps: string[];
    }>(fixturePath, "plainThing", {
      hooks: [
        (value, context) => {
          seen.push(`${context.family}:${context.loaderName}:call`);
          return {
            ...(value as Record<string, unknown>),
            steps: [
              ...((value as { steps: string[] }).steps ?? []),
              "call",
            ],
          };
        },
      ],
    });

    expect(seen).toEqual([
      "service:plainThing:base",
      "service:ObjectLoader:call",
    ]);
    expect(result.steps).toEqual(["base", "call"]);
  });

  it.each([
    [ModelObjectLoader, "model", "loadModel"],
    [AdapterObjectLoader, "adapter", "loadAdapter"],
    [RepositoryObjectLoader, "repository", "loadRepository"],
    [ServiceObjectLoader, "service", "loadService"],
    [ControllerObjectLoader, "controller", "loadController"],
    [EnvironmentObjectLoader, "environment", "loadEnvironment"],
    [AngularComponentObjectLoader, "component", "loadComponent"],
    [GraphNodeObjectLoader, "node", "loadNode"],
  ] as const)(
    "configures %s as a %s loader",
    async (LoaderClass, family, methodName) => {
      const namespace = (await import(
        pathToFileURL(fixturePath).href
      )) as {
        default: unknown;
      };
      const loader = new LoaderClass();
      const loaderAsRecord = loader as Record<string, unknown>;

      expect(loader.family).toBe(family);
      expect(typeof loaderAsRecord[methodName]).toBe("function");

      const loaded = await (loaderAsRecord[methodName] as (
        source: string
      ) => Promise<unknown>)(fixturePath);

      expect(loaded).toBe(namespace.default);
    }
  );
});
