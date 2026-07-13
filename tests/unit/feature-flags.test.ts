import { Metadata } from "@decaf-ts/decoration";
import { Model } from "@decaf-ts/decorator-validation";
import {
  EnvironmeFlagReader,
  FEATURE_FLAG_AUTH_KEY,
  FEATURE_FLAG_MODEL_KEY,
  FEATURE_FLAG_RENDER_KEY,
  FeatureFlagService,
  featureFlags,
  featureAuth,
  renderIfFeature,
  hideOnFeature,
  loadFeatureFlagsFromEnvironment,
  isFeatureFlagEnabledByName,
  shouldExposeForFeatures,
  shouldHideForFeatures,
} from "../../src/feature-flags";

describe("feature-flags", () => {
  function createSelectChain<T>(responses: T[][]) {
    const queue = [...responses];
    let selectCalls = 0;
    let whereCalls = 0;
    const select = () => {
      selectCalls += 1;
      return {
        where: () => {
          whereCalls += 1;
          return {
            execute: async () => queue.shift() ?? [],
          };
        },
        execute: async () => queue.shift() ?? [],
      };
    };
    return {
      select,
      get selectCalls() {
        return selectCalls;
      },
      get whereCalls() {
        return whereCalls;
      },
    };
  }

  function createFeatureRepositoryStub<T extends { key: string }>(
    rows: T[]
  ) {
    const enabledRows = rows.filter(
      (row: any) => row.enabled === true || typeof row.enabled === "undefined"
    );
    const selectChain = createSelectChain([[], enabledRows]);
    let findOneByCalls = 0;
    return {
      findOneBy: async (_key: keyof T, value: any) => {
        findOneByCalls += 1;
        const normalized =
          typeof value === "string" ? value.replace(/[_\s-]+([a-z])/gi, (_, c) => c.toUpperCase()) : value;
        return rows.find((row) => row.key === normalized);
      },
      select: selectChain.select,
      get findOneByCalls() {
        return findOneByCalls;
      },
      get selectCalls() {
        return selectChain.selectCalls;
      },
      get whereCalls() {
        return selectChain.whereCalls;
      },
    };
  }

  it("normalizes featureFlag environment objects into camelCase feature keys", async () => {
    const registry = await loadFeatureFlagsFromEnvironment({
      featureFlag: {
        FEATURE_ALPHA: true,
        FEATURE_BETA: {
          enabled: "true",
          rollout_percent: "25",
          nested_flag: {
            sample_value: "hello",
          },
        },
      },
    });

    expect(registry).toEqual({
      featureAlpha: true,
      featureBeta: {
        enabled: true,
        rolloutPercent: 25,
        nestedFlag: {
          sampleValue: "hello",
        },
      },
    });
    expect(isFeatureFlagEnabledByName(registry, "FEATURE_ALPHA")).toBe(true);
    expect(isFeatureFlagEnabledByName(registry, "featureBeta")).toBe(true);
  });

  it("stores feature metadata on models and members", () => {
    @featureFlags("feature_alpha", "feature_beta")
    class FeatureModel extends Model {
      @renderIfFeature("feature_alpha")
      public title!: string;

      @featureAuth("feature_beta")
      public read(): string {
        return "ok";
      }

      @hideOnFeature("feature_gamma")
      public hiddenField!: string;
    }

    expect(Metadata.get(FeatureModel, FEATURE_FLAG_MODEL_KEY)).toEqual({
      features: ["featureAlpha", "featureBeta"],
      match: "any",
    });
    expect(
      Metadata.get(
        FeatureModel,
        Metadata.key(FEATURE_FLAG_RENDER_KEY, "title")
      )
    ).toEqual({
      features: ["featureAlpha"],
      match: "any",
    });
    expect(
      Metadata.get(FeatureModel, Metadata.key(FEATURE_FLAG_AUTH_KEY, "read"))
    ).toEqual({
      features: ["featureBeta"],
      match: "any",
    });
    expect(
      Metadata.get(
        FeatureModel,
        Metadata.key("feature-flags:hide-on", "hiddenField")
      )
    ).toEqual({
      features: ["featureGamma"],
      match: "any",
    });
  });

  it("evaluates feature rules against enabled registries", async () => {
    const registry = await loadFeatureFlagsFromEnvironment({
      featureFlag: {
        FEATURE_ALPHA: true,
        FEATURE_BETA: false,
      },
    });

    @featureFlags("feature_alpha")
    class FeatureModel extends Model {}

    expect(
      shouldExposeForFeatures(FeatureModel, registry, FEATURE_FLAG_MODEL_KEY)
    ).toBe(true);

    @hideOnFeature("feature_alpha")
    class HiddenModel extends Model {}

    expect(
      shouldHideForFeatures(HiddenModel, registry, "feature-flags:hide-on")
    ).toBe(true);
  });

  it("uses a swappable reader and cached registry for sync checks", async () => {
    class StaticReader extends EnvironmeFlagReader {
      override async read() {
        return {
          featureAlpha: true,
          featureBeta: false,
        };
      }
    }

    const service = new FeatureFlagService();
    await service.initialize({
      reader: StaticReader,
    });

    expect(service.isEnabled("feature_alpha")).toBe(true);
    expect(service.isEnabled("feature_beta")).toBe(false);
    expect(await service.resolveFeatureFlags()).toEqual({
      featureAlpha: true,
      featureBeta: false,
    });
  });

  it("uses select().where().execute() for feature lookups", async () => {
    const rows = [
      { key: "featureAlpha", enabled: true, config: true },
      { key: "featureBeta", enabled: false, config: false },
    ];
    const repo = createFeatureRepositoryStub(rows);

    const service = new FeatureFlagService();
    await service.initialize({
      repository: repo as any,
    });

    await expect(service.findOneBy("key", "feature_alpha")).resolves.toEqual(rows[0]);
    await expect(service.listEnabled()).resolves.toEqual([rows[0]]);
    expect(repo.findOneByCalls).toBe(1);
    expect(repo.selectCalls).toBe(2);
    expect(repo.whereCalls).toBe(1);
  });

  it("resolves subject access through persisted access rows and feature queries", async () => {
    const featureRows = [
      { key: "featureAlpha", enabled: true, config: true },
      { key: "featureBeta", enabled: true, config: { rolloutPercent: 25 } },
    ];
    const accessRows = [
      {
        featureKey: "featureAlpha",
        subjectType: "user",
        subjectKey: "user-1",
        enabled: true,
      },
      {
        featureKey: "featureBeta",
        subjectType: "user",
        subjectKey: "user-1",
        enabled: true,
      },
    ];

    const featureChain = createSelectChain([[], featureRows]);
    const accessChain = createSelectChain([accessRows]);

    const service = new FeatureFlagService();
    await service.initialize({
      repository: { select: featureChain.select } as any,
    });
    (service as any).accessRepository = { select: accessChain.select } as any;

    await expect(
      service.resolveFeatureFlagsForSubject({
        subjectType: "user",
        subjectKey: "user-1",
      })
    ).resolves.toEqual({
      featureAlpha: true,
      featureBeta: {
        rolloutPercent: 25,
      },
    });

    expect(accessChain.selectCalls).toBe(1);
    expect(accessChain.whereCalls).toBe(1);
    expect(featureChain.selectCalls).toBe(2);
    expect(featureChain.whereCalls).toBe(1);
  });
});
