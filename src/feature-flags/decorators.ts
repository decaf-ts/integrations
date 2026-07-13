import {
  Metadata,
  metadata,
  methodMetadata,
  propMetadata,
} from "@decaf-ts/decoration";
import {
  FEATURE_FLAG_AUTH_KEY,
  FEATURE_FLAG_BLOCK_KEY,
  FEATURE_FLAG_HIDE_KEY,
  FEATURE_FLAG_MODEL_KEY,
  FEATURE_FLAG_RENDER_KEY,
} from "./constants";
import type { FeatureFlagRule } from "./types";
import {
  normalizeFeatureRule,
  isFeatureRuleBlocked,
  isFeatureRuleSatisfied,
  readMetadata,
} from "./utils";

type FeatureDecoratorKey =
  | typeof FEATURE_FLAG_MODEL_KEY
  | typeof FEATURE_FLAG_AUTH_KEY
  | typeof FEATURE_FLAG_BLOCK_KEY
  | typeof FEATURE_FLAG_RENDER_KEY
  | typeof FEATURE_FLAG_HIDE_KEY;

function featureMetadataKey(
  key: FeatureDecoratorKey,
  propertyKey?: string | symbol
): string {
  return typeof propertyKey === "undefined"
    ? key
    : Metadata.key(key, propertyKey.toString());
}

function applyFeatureDecorator(
  key: FeatureDecoratorKey,
  features: string[],
  match: FeatureFlagRule["match"] = "any"
) {
  const rule = normalizeFeatureRule(features, match);
  return function featureDecorator(
    target: any,
    propertyKey?: string | symbol,
    descriptor?: PropertyDescriptor
  ) {
    if (typeof propertyKey === "undefined") {
      return metadata(key, rule)(target);
    }
    const scopedKey = featureMetadataKey(key, propertyKey);
    if (descriptor) {
      return methodMetadata(scopedKey, rule)(target, propertyKey, descriptor);
    }
    return propMetadata(scopedKey, rule)(target, propertyKey);
  };
}

export function featureFlags(...features: string[]) {
  return applyFeatureDecorator(FEATURE_FLAG_MODEL_KEY, features);
}

export function featureAuth(...features: string[]) {
  return applyFeatureDecorator(FEATURE_FLAG_AUTH_KEY, features);
}

export function blockFeatureOperations(...features: string[]) {
  return applyFeatureDecorator(FEATURE_FLAG_BLOCK_KEY, features);
}

export function renderIfFeature(...features: string[]) {
  return applyFeatureDecorator(FEATURE_FLAG_RENDER_KEY, features);
}

export function hideOnFeature(...features: string[]) {
  return applyFeatureDecorator(FEATURE_FLAG_HIDE_KEY, features);
}

export function getFeatureGateMetadata(
  target: object,
  key:
    | typeof FEATURE_FLAG_MODEL_KEY
    | typeof FEATURE_FLAG_AUTH_KEY
    | typeof FEATURE_FLAG_BLOCK_KEY
    | typeof FEATURE_FLAG_RENDER_KEY
    | typeof FEATURE_FLAG_HIDE_KEY,
  propertyKey?: string | symbol
): FeatureFlagRule | undefined {
  return readMetadata<FeatureFlagRule>(
    target,
    featureMetadataKey(key, propertyKey)
  );
}

export function shouldExposeForFeatures(
  target: object,
  enabledFeatures: Record<string, unknown>,
  key:
    | typeof FEATURE_FLAG_MODEL_KEY
    | typeof FEATURE_FLAG_AUTH_KEY
    | typeof FEATURE_FLAG_BLOCK_KEY
    | typeof FEATURE_FLAG_RENDER_KEY
    | typeof FEATURE_FLAG_HIDE_KEY,
  propertyKey?: string | symbol
) {
  const rule = getFeatureGateMetadata(target, key, propertyKey);
  return isFeatureRuleSatisfied(rule, enabledFeatures as any);
}

export function shouldHideForFeatures(
  target: object,
  enabledFeatures: Record<string, unknown>,
  key:
    | typeof FEATURE_FLAG_MODEL_KEY
    | typeof FEATURE_FLAG_AUTH_KEY
    | typeof FEATURE_FLAG_BLOCK_KEY
    | typeof FEATURE_FLAG_RENDER_KEY
    | typeof FEATURE_FLAG_HIDE_KEY,
  propertyKey?: string | symbol
) {
  const rule = getFeatureGateMetadata(target, key, propertyKey);
  return isFeatureRuleBlocked(rule, enabledFeatures as any);
}

export {
  FEATURE_FLAG_AUTH_KEY,
  FEATURE_FLAG_BLOCK_KEY,
  FEATURE_FLAG_HIDE_KEY,
  FEATURE_FLAG_MODEL_KEY,
  FEATURE_FLAG_RENDER_KEY,
};
