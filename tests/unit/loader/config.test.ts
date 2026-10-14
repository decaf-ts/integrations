import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

import { UnsupportedError } from "@decaf-ts/core";
import { ConflictError, NotFoundError } from "@decaf-ts/db-decorators";

import {
  ConfigObjectLoader,
  globalConfig,
  GlobalConfigRegistry,
} from "../../../src/loader";

describe("GlobalConfigRegistry", () => {
  let registry: GlobalConfigRegistry;

  beforeEach(() => {
    registry = new GlobalConfigRegistry();
  });

  it("registers and reads values back", () => {
    registry.register("app", { retries: 3 });

    expect(registry.has("app")).toBe(true);
    expect(registry.has("missing")).toBe(false);
    expect(registry.get<{ retries: number }>("app")).toEqual({ retries: 3 });
    expect(registry.require<{ retries: number }>("app")).toEqual({
      retries: 3,
    });
    expect(registry.get("missing")).toBeUndefined();
  });

  it("lists keys and entries and snapshots the store", () => {
    registry.register("a", 1).register("b", 2);

    expect(registry.keys()).toEqual(["a", "b"]);
    expect(registry.entries()).toEqual([
      ["a", 1],
      ["b", 2],
    ]);
    const snapshot = registry.snapshot();
    expect(snapshot).toEqual({ a: 1, b: 2 });
    expect(Object.isFrozen(snapshot)).toBe(true);
  });

  it("clears registered values", () => {
    registry.register("a", 1);
    registry.clear();

    expect(registry.has("a")).toBe(false);
    expect(registry.keys()).toEqual([]);
  });

  it("throws ConflictError for a duplicate key without override", () => {
    registry.register("a", 1);

    expect(() => registry.register("a", 2)).toThrow(ConflictError);
    expect(registry.get("a")).toBe(1);
  });

  it("replaces an existing key with override: true", () => {
    registry.register("a", 1);
    registry.register("a", 2, { override: true });

    expect(registry.get("a")).toBe(2);
  });

  it("throws NotFoundError when requiring a missing key", () => {
    expect(() => registry.require("missing")).toThrow(NotFoundError);
  });

  it("freezes the registry and rejects later registrations", () => {
    registry.register("a", 1);
    expect(registry.isFrozen).toBe(false);

    expect(registry.freeze()).toBe(registry);
    expect(registry.isFrozen).toBe(true);
    expect(() => registry.register("b", 2)).toThrow(UnsupportedError);
    expect(registry.has("b")).toBe(false);
    expect(registry.get("a")).toBe(1);
  });

  it("exposes a stable globalConfig singleton", () => {
    expect(globalConfig).toBe(GlobalConfigRegistry.instance);
    expect(globalConfig).toBeInstanceOf(GlobalConfigRegistry);

    globalConfig.register("saa55:global", { ok: true });
    expect(globalConfig.get("saa55:global")).toEqual({ ok: true });

    GlobalConfigRegistry.reset();
    expect(globalConfig.has("saa55:global")).toBe(false);
  });
});

describe("ConfigObjectLoader", () => {
  let tempDir: string;
  let registry: GlobalConfigRegistry;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "decaf-config-loader-"));
    registry = new GlobalConfigRegistry();
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("registers an inline object under the derived key", async () => {
    const loader = new ConfigObjectLoader({ registry });

    const value = await loader.loadConfig<{ retries: number }>({
      retries: 3,
    });

    expect(loader.family).toBe("config");
    expect(value).toEqual({ retries: 3 });
    expect(registry.require("config")).toEqual({ retries: 3 });
    expect(loader.get("config")).toEqual({ retries: 3 });
  });

  it("registers under an explicit key and namespace", async () => {
    const loader = new ConfigObjectLoader({ registry });

    await loader.loadConfig({ retries: 3 }, { key: "custom" });
    await loader.loadConfig({ retries: 5 }, { namespace: "tenant" });

    expect(registry.require("custom")).toEqual({ retries: 3 });
    expect(registry.require("tenant:config")).toEqual({ retries: 5 });
  });

  it("loads and registers a .json file under the derived name", async () => {
    const jsonPath = join(tempDir, "settings.json");
    writeFileSync(jsonPath, JSON.stringify({ retries: 7 }), "utf8");
    const loader = new ConfigObjectLoader({ registry });

    const value = await loader.loadConfig<{ retries: number }>(jsonPath);

    expect(value).toEqual({ retries: 7 });
    expect(registry.require("settings")).toEqual({ retries: 7 });
  });

  it("loads and registers a module default export", async () => {
    const modulePath = join(tempDir, "app-config.mjs");
    writeFileSync(modulePath, "export default { retries: 9 };", "utf8");
    const loader = new ConfigObjectLoader({ registry });

    const value = await loader.loadConfig<{ retries: number }>(modulePath);

    expect(value).toEqual({ retries: 9 });
    expect(registry.require("app-config")).toEqual({ retries: 9 });
  });

  it("runs hooks and registers the processed value", async () => {
    const seen: unknown[] = [];
    let metadata: Readonly<Record<string, unknown>> | undefined;
    const loader = new ConfigObjectLoader({
      registry,
      hooks: [
        (value, context) => {
          seen.push(value);
          metadata = context.metadata;
          return { ...(value as Record<string, unknown>), hooked: true };
        },
      ],
    });

    const value = await loader.loadConfig<{ hooked: boolean }>({ retries: 1 });

    expect(seen).toEqual([{ retries: 1 }]);
    expect(metadata).toMatchObject({ key: "config" });
    expect(value).toEqual({ retries: 1, hooked: true });
    expect(registry.require("config")).toEqual({ retries: 1, hooked: true });
  });

  it("throws ConflictError for a duplicate key unless override is set", async () => {
    const loader = new ConfigObjectLoader({ registry });
    await loader.loadConfig({ retries: 1 }, { key: "shared" });

    await expect(
      loader.loadConfig({ retries: 2 }, { key: "shared" })
    ).rejects.toBeInstanceOf(ConflictError);
    expect(registry.require("shared")).toEqual({ retries: 1 });

    await loader.loadConfig({ retries: 2 }, { key: "shared", override: true });
    expect(registry.require("shared")).toEqual({ retries: 2 });
  });

  it("loadAndRegister is an alias for loadConfig", async () => {
    const loader = new ConfigObjectLoader({ registry });

    await loader.loadAndRegister({ retries: 4 }, { key: "alias" });
    expect(registry.require("alias")).toEqual({ retries: 4 });
  });

  it("supports the loader register and get helpers", () => {
    const loader = new ConfigObjectLoader({ registry });

    loader.register("manual", { enabled: true });
    expect(loader.get("manual")).toEqual({ enabled: true });
    expect(loader.get("missing")).toBeUndefined();

    loader.register("manual", { enabled: false }, { override: true });
    expect(loader.get("manual")).toEqual({ enabled: false });
  });

  it("preserves the registry across withHooks", async () => {
    const loader = new ConfigObjectLoader({ registry });
    const hooked = loader.withHooks((value) => ({
      ...(value as Record<string, unknown>),
      hooked: true,
    }));

    expect(hooked).not.toBe(loader);
    expect(hooked).toBeInstanceOf(ConfigObjectLoader);
    await hooked.loadConfig({ retries: 1 }, { key: "hooked" });

    expect(registry.require("hooked")).toEqual({ retries: 1, hooked: true });
  });
});
