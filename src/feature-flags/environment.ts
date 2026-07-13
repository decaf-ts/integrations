import { LoggedEnvironment } from "@decaf-ts/logging";
import {
  FEATURE_FLAG_ENV_ROOT,
  FEATURE_FLAG_ENV_PREFIX,
} from "./constants";
import { normalizeFeatureName, normalizeFeatureRegistry } from "./utils";
import type {
  FeatureFlagEnvironmentShape,
  FeatureFlagRegistry,
  FeatureFlagValue,
} from "./types";

export const FeatureFlagEnvironment = LoggedEnvironment.accumulate({
  [FEATURE_FLAG_ENV_ROOT]: {},
} as FeatureFlagEnvironmentShape);

export async function loadFeatureFlagsFromEnvironment(
  source: Pick<FeatureFlagEnvironmentShape, "featureFlag"> = FeatureFlagEnvironment
): Promise<FeatureFlagRegistry> {
  return normalizeFeatureRegistry(source.featureFlag);
}

export async function resolveFeatureFlagFromEnvironment(
  featureName: string,
  source: Pick<FeatureFlagEnvironmentShape, "featureFlag"> = FeatureFlagEnvironment
): Promise<FeatureFlagValue | undefined> {
  const registry = await loadFeatureFlagsFromEnvironment(source);
  return registry[normalizeFeatureName(featureName)];
}

export async function hasFeatureFlagInEnvironment(
  featureName: string,
  source: Pick<FeatureFlagEnvironmentShape, "featureFlag"> = FeatureFlagEnvironment
): Promise<boolean> {
  return !!(await resolveFeatureFlagFromEnvironment(featureName, source));
}

export { FEATURE_FLAG_ENV_PREFIX, FEATURE_FLAG_ENV_ROOT };
