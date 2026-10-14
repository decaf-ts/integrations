import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { pathToFileURL } from "url";

import {
  createLoaderHookContext,
  ModelObjectLoader,
  moduleReference,
  ObjectLoader,
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

export const onlyNamed = {
  label: "only",
};

export default DefaultThing;
`;

const singleExportSource = `
export const onlyExport = {
  label: "only-export",
};
`;

const multiExportSource = `
export const first = { label: "first" };
export const second = { label: "second" };
`;

describe("ObjectLoader (base API)", () => {
  let tempDir: string;
  let fixturePath: string;

  const writeFixture = (name: string, source: string): string => {
    const path = join(tempDir, name);
    writeFileSync(path, source, "utf8");
    return path;
  };

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "decaf-object-loader-base-"));
    fixturePath = writeFixture("fixture.mjs", fixtureSource);
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("loads the default export through load()", async () => {
    const namespace = (await import(pathToFileURL(fixturePath).href)) as {
      default: unknown;
    };
    const loader = new ObjectLoader();

    expect(await loader.load(fixturePath)).toBe(namespace.default);
  });

  it("normalizes URL and file: sources", async () => {
    const namespace = (await import(pathToFileURL(fixturePath).href)) as {
      default: unknown;
    };
    const loader = new ObjectLoader();

    expect(await loader.loadDefault(new URL(pathToFileURL(fixturePath).href))).toBe(
      namespace.default
    );
    expect(
      await loader.loadDefault(pathToFileURL(fixturePath).href)
    ).toBe(namespace.default);
  });

  it("falls back to the single named export when no default is present", async () => {
    const singlePath = writeFixture("single.mjs", singleExportSource);
    const namespace = (await import(pathToFileURL(singlePath).href)) as {
      onlyExport: unknown;
    };
    const loader = new ObjectLoader();

    expect(await loader.loadDefault(singlePath)).toBe(namespace.onlyExport);
  });

  it("throws when a default export cannot be resolved", async () => {
    const multiPath = writeFixture("multi.mjs", multiExportSource);
    const loader = new ObjectLoader();

    await expect(loader.loadDefault(multiPath)).rejects.toThrow(
      /does not expose a default export/
    );
  });

  it("throws when a named export is missing", async () => {
    const loader = new ObjectLoader();

    await expect(loader.loadExport(fixturePath, "Missing")).rejects.toThrow(
      /does not export "Missing"/
    );
  });

  it("returns a new instance from withHooks without mutating the original", async () => {
    const seen: string[] = [];
    const base = new ObjectLoader();
    const hooked = base.withHooks((value, context) => {
      seen.push(context.loaderName);
      return { ...(value as Record<string, unknown>), hooked: true };
    });

    expect(hooked).not.toBe(base);
    expect(hooked).toBeInstanceOf(ObjectLoader);

    const untouched = (await base.loadDefault(fixturePath)) as {
      hooked?: boolean;
    };
    expect(untouched.hooked).toBeUndefined();

    const modified = (await hooked.loadDefault(fixturePath)) as {
      hooked?: boolean;
    };
    expect(modified.hooked).toBe(true);
    expect(seen).toEqual(["ObjectLoader"]);
  });

  it("returns a new instance from withBeforeResolveHooks and replaces the namespace", async () => {
    const replacement = { default: { replaced: true }, extra: true };
    const base = new ObjectLoader();
    const hooked = base.withBeforeResolveHooks(() => replacement);

    expect(hooked).not.toBe(base);
    expect(await hooked.loadDefault(fixturePath)).toEqual({ replaced: true });
    expect(await base.loadDefault(fixturePath)).not.toEqual({ replaced: true });
  });

  it("merges options and preserves the concrete loader class in withOptions", async () => {
    const seen: string[] = [];
    const model = new ModelObjectLoader({
      metadata: { base: true },
      hooks: [
        (value, context) => {
          seen.push(`base:${String(context.metadata?.base)}`);
          return value;
        },
      ],
    });

    const next = model.withOptions({
      hooks: [
        (value, context) => {
          seen.push(`call:${String(context.metadata?.extra)}`);
          return value;
        },
      ],
      metadata: { extra: true },
    });

    expect(next).not.toBe(model);
    expect(next).toBeInstanceOf(ModelObjectLoader);
    expect(next.family).toBe("model");

    await next.loadModel(fixturePath, "NamedThing");
    expect(seen).toEqual(["base:true", "call:true"]);
  });

  it("runs beforeResolve and afterResolve hooks with their phase", async () => {
    const phases: string[] = [];
    const loader = new ObjectLoader({
      hooks: [
        (value, context) => {
          phases.push(context.phase as string);
          return value;
        },
      ],
      beforeResolveHooks: [
        (value, context) => {
          phases.push(context.phase as string);
          return value;
        },
      ],
    });

    await loader.loadExport(fixturePath, "plainThing");
    expect(phases).toEqual(["beforeResolve", "afterResolve"]);
  });

  it("runs base hooks before per-call hooks for both phases", async () => {
    const seen: string[] = [];
    const loader = new ObjectLoader({
      hooks: [
        (value) => {
          seen.push("base:after");
          return value;
        },
      ],
      beforeResolveHooks: [
        (value) => {
          seen.push("base:before");
          return value;
        },
      ],
    });

    await loader.loadExport(fixturePath, "plainThing", {
      hooks: [
        (value) => {
          seen.push("call:after");
          return value;
        },
      ],
      beforeResolveHooks: [
        (value) => {
          seen.push("call:before");
          return value;
        },
      ],
    });

    expect(seen).toEqual([
      "base:before",
      "call:before",
      "base:after",
      "call:after",
    ]);
  });

  it("passes the imported namespace to beforeResolve hooks and the export to afterResolve hooks", async () => {
    let beforeModule: Readonly<Record<string, unknown>> | undefined;
    let afterValue: unknown;
    const loader = new ObjectLoader({
      beforeResolveHooks: [
        (value) => {
          beforeModule = value as Readonly<Record<string, unknown>>;
          return value;
        },
      ],
      hooks: [
        (value) => {
          afterValue = value;
          return value;
        },
      ],
    });

    await loader.loadExport(fixturePath, "plainThing");
    expect(beforeModule).toHaveProperty("plainThing");
    expect(beforeModule).toHaveProperty("default");
    expect(afterValue).toEqual({ label: "plain", steps: [] });
  });

  it("carries per-call metadata into the hook context", async () => {
    let metadata: Readonly<Record<string, unknown>> | undefined;
    const loader = new ObjectLoader({ metadata: { base: true } });

    await loader.loadExport(fixturePath, "plainThing", {
      metadata: { call: true },
      hooks: [
        (value, context) => {
          metadata = context.metadata;
          return value;
        },
      ],
    });

    expect(metadata).toEqual({ call: true });
  });

  it("builds a hook context via createLoaderHookContext", () => {
    const loader = new ObjectLoader({ family: "model" });
    const module = { default: {} };
    const context = createLoaderHookContext(
      loader,
      module,
      "file:///tmp/thing.mjs",
      "Thing"
    );

    expect(context).toEqual({
      family: "model",
      source: "file:///tmp/thing.mjs",
      exportName: "Thing",
      module,
      loaderName: "ObjectLoader",
      phase: "afterResolve",
      metadata: {},
    });

    const phased = createLoaderHookContext(
      loader,
      module,
      "file:///tmp/thing.mjs",
      "Thing",
      "beforeResolve",
      { key: "value" }
    );
    expect(phased.phase).toBe("beforeResolve");
    expect(phased.metadata).toEqual({ key: "value" });
  });

  it("returns an importable lazy module reference", async () => {
    const reference = moduleReference(pathToFileURL(fixturePath).href);
    const namespace = await reference();

    expect(namespace).toHaveProperty("plainThing");
    expect(namespace).toHaveProperty("default");
  });

  it("loads a module namespace via loadModule", async () => {
    const namespace = (await import(pathToFileURL(fixturePath).href)) as {
      plainThing: unknown;
    };
    const loader = new ObjectLoader();

    expect(await loader.loadModule(fixturePath)).toBe(namespace);
  });
});
