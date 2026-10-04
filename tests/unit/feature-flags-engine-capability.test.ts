/**
 * @module integrations/tests/unit/feature-flags-engine-capability.test
 * @summary SAA-197 verification for the C22 capability-derived feature flags
 * (`src/feature-flags/EngineCapabilityFeatureFlag.service.ts`).
 * @description Pins the fail-closed contract of the engine capability feature
 * flags:
 * - {@link engineCapabilityFlagRegistry} maps `SUPPORTED` to enabled and
 *   `NOT_SUPPORTED`/`EXTENSION_POINT` to disabled;
 * - {@link EngineCapabilityFeatureFlagService} after `initialize({ manifest })`
 *   answers `isEngineEnabled`/`isEngineFeatureEnabled` exactly as declared;
 * - **C22 fail-closed**: an undeclared feature key resolves `false` from
 *   `isEnabled` and `isEnabledForSubject`, is absent from
 *   `resolveFeatureFlags()`, and `syncFromEnvironment()` throws rather than
 *   reading the environment;
 * - the derived registry does not depend on `process.env`: mutating
 *   `FEATURE_FLAG_*` leaves every read path unchanged.
 */
import { describe, it, expect } from "@jest/globals";

import {
  EngineCapabilityFeatureFlagService,
  engineCapabilityFlagKey,
  engineCapabilityFlagRegistry,
  type EngineCapabilityManifestInput,
} from "../../src/feature-flags";

const MANIFEST: EngineCapabilityManifestInput = {
  engines: [
    {
      engineId: "local",
      capabilities: [
        { feature: "codeMode", verdict: "SUPPORTED" },
        { feature: "workflowList", verdict: "SUPPORTED" },
        { feature: "workflowLookup", verdict: "NOT_SUPPORTED" },
        { feature: "whileUntil", verdict: "EXTENSION_POINT" },
      ],
    },
    {
      engineId: "dagster",
      capabilities: [
        { feature: "schedule", verdict: "SUPPORTED" },
        { feature: "manualTrigger", verdict: "EXTENSION_POINT" },
      ],
    },
  ],
  defaultEngineId: "local",
};

async function initializedService(): Promise<EngineCapabilityFeatureFlagService> {
  const service = new EngineCapabilityFeatureFlagService();
  await service.initialize({ manifest: MANIFEST });
  return service;
}

describe("engine capability feature flags (SAA-197 C22)", () => {
  describe("engineCapabilityFlagRegistry", () => {
    it("enables an engine key and only SUPPORTED feature keys", () => {
      const registry = engineCapabilityFlagRegistry(MANIFEST);

      expect(registry[engineCapabilityFlagKey("local")]).toBe(true);
      expect(registry[engineCapabilityFlagKey("dagster")]).toBe(true);

      expect(registry[engineCapabilityFlagKey("local", "codeMode")]).toBe(
        true
      );
      expect(
        registry[engineCapabilityFlagKey("local", "workflowList")]
      ).toBe(true);
      expect(
        registry[engineCapabilityFlagKey("local", "workflowLookup")]
      ).toBe(false);
      expect(
        registry[engineCapabilityFlagKey("local", "whileUntil")]
      ).toBe(false);

      expect(
        registry[engineCapabilityFlagKey("dagster", "schedule")]
      ).toBe(true);
      expect(
        registry[engineCapabilityFlagKey("dagster", "manualTrigger")]
      ).toBe(false);
    });

    it("builds the documented camel-cased canonical keys", () => {
      expect(engineCapabilityFlagKey("local")).toBe("engineLocal");
      expect(engineCapabilityFlagKey("local", "codeMode")).toBe(
        "engineLocalCodeMode"
      );
      expect(engineCapabilityFlagKey("local", "workflowList")).toBe(
        "engineLocalWorkflowList"
      );
    });

    it("derives an empty registry from a missing manifest (fail-closed)", () => {
      expect(engineCapabilityFlagRegistry({ engines: [] })).toEqual({});
    });
  });

  describe("EngineCapabilityFeatureFlagService", () => {
    // SAA-197 finding (do not fix here): `EngineCapabilityFeatureFlagService`
    // extends the `@service(FeatureFlag)`-decorated `FeatureFlagService` but does
    // not carry its own `@service()` decorator. The base decorator replaces the
    // parent constructor with one that returns the cached `FeatureFlagService`
    // singleton, so `new EngineCapabilityFeatureFlagService()` yields a base
    // `FeatureFlagService` (no `isEngineEnabled`, base `listEnabled` reading
    // `this.repo`). Every test below therefore fails on construction; the
    // registry/key tests above (pure functions) pass. Verified fix: decorating the
    // subclass with `@service()` restores the subclass methods.
    it("constructs as an EngineCapabilityFeatureFlagService", () => {
      expect(new EngineCapabilityFeatureFlagService()).toBeInstanceOf(
        EngineCapabilityFeatureFlagService
      );
    });

    it("answers isEngineEnabled/isEngineFeatureEnabled as declared", async () => {
      const service = await initializedService();

      expect(service.isEngineEnabled("local")).toBe(true);
      expect(service.isEngineEnabled("dagster")).toBe(true);
      expect(service.isEngineEnabled("mastra")).toBe(false);

      expect(service.isEngineFeatureEnabled("local", "codeMode")).toBe(true);
      expect(service.isEngineFeatureEnabled("local", "workflowList")).toBe(
        true
      );
      expect(
        service.isEngineFeatureEnabled("local", "workflowLookup")
      ).toBe(false);
      expect(service.isEngineFeatureEnabled("local", "whileUntil")).toBe(
        false
      );
    });

    it("resolves declared flags and omits undeclared ones (C22 fail-closed)", async () => {
      const service = await initializedService();

      const resolved = await service.resolveFeatureFlags();
      expect(resolved).toMatchObject({
        engineLocal: true,
        engineLocalCodeMode: true,
        engineLocalWorkflowList: true,
        engineLocalWorkflowLookup: false,
        engineDagster: true,
        engineDagsterSchedule: true,
        engineDagsterManualTrigger: false,
      });

      // undeclared feature key: denied on every read path
      expect(service.isEnabled("engineLocalUndeclaredFeature")).toBe(false);
      await expect(
        service.isEnabledForSubject("engineLocalUndeclaredFeature", {
          subjectType: "user",
          subjectKey: "user-1",
        })
      ).resolves.toBe(false);
      expect(resolved).not.toHaveProperty(
        "engineLocalUndeclaredFeature"
      );
      expect(service.isEngineFeatureEnabled("local", "undeclared")).toBe(
        false
      );
    });

    it("fails syncFromEnvironment closed instead of reading the environment", async () => {
      const service = await initializedService();
      await expect(service.syncFromEnvironment()).rejects.toThrow(
        /never synced from the environment/
      );
    });

    it("does not derive flag values from process.env", async () => {
      const service = await initializedService();
      const before = await service.resolveFeatureFlags();

      const envKeys = [
        "FEATURE_FLAG_ENGINE_LOCAL",
        "FEATURE_FLAG_ENGINE_LOCAL_CODE_MODE",
        "FEATURE_FLAG_ENGINE_LOCAL_UNDECLARED_FEATURE",
        "featureFlag",
      ] as const;
      const saved: Record<string, string | undefined> = {};
      for (const key of envKeys) {
        saved[key] = process.env[key];
        process.env[key] = "true";
      }

      try {
        expect(service.isEnabled("engineLocalCodeMode")).toBe(true);
        expect(service.isEnabled("engineLocalUndeclaredFeature")).toBe(false);
        expect(service.isEngineFeatureEnabled("local", "workflowLookup")).toBe(
          false
        );
        expect(await service.resolveFeatureFlags()).toEqual(before);
      } finally {
        for (const key of envKeys) {
          if (saved[key] === undefined) delete process.env[key];
          else process.env[key] = saved[key];
        }
      }
    });

    it("lists only the enabled capability flags without a repository", async () => {
      const service = await initializedService();
      const enabled = await service.listEnabled();
      const keys = enabled.map((flag) => flag.key).sort();
      expect(keys).toContain("engineLocal");
      expect(keys).toContain("engineLocalCodeMode");
      expect(keys).not.toContain("engineLocalWorkflowLookup");
      expect(keys).not.toContain("engineLocalWhileUntil");
    });

    it("denies every feature when initialized without a manifest", async () => {
      const service = new EngineCapabilityFeatureFlagService();
      await service.initialize({});
      expect(service.isEngineEnabled("local")).toBe(false);
      expect(service.isEnabled("engineLocalCodeMode")).toBe(false);
      expect(await service.resolveFeatureFlags()).toEqual({});
    });
  });
});
