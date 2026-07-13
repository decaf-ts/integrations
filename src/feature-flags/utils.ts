import { Metadata } from "@decaf-ts/decoration";
import {
  FeatureFlagConfig,
  FeatureFlagAccessSubjectType,
  FeatureFlagMatchMode,
  FeatureFlagRegistry,
  FeatureFlagRule,
  FeatureFlagValue,
} from "./types";

export function normalizeFeatureName(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return trimmed;
  if (/^[a-z][a-zA-Z0-9]*$/.test(trimmed)) return trimmed;
  const camelized = trimmed
    .toLowerCase()
    .replace(/[_\-\s]+/g, " ")
    .split(" ")
    .filter(Boolean);
  if (camelized.length === 0) return trimmed;
  const [head, ...tail] = camelized;
  return [
    head,
    ...tail.map((segment) =>
      segment ? segment.charAt(0).toUpperCase() + segment.slice(1) : segment
    ),
  ]
    .join("")
    .replace(/[^a-zA-Z0-9]/g, "");
}

export function parseRuntimeValue(value: unknown): unknown {
  if (typeof value !== "string") return value;
  const trimmed = value.trim();
  if (trimmed === "true") return true;
  if (trimmed === "false") return false;
  if (/^-?\d+(\.\d+)?$/.test(trimmed)) return Number(trimmed);
  if (
    (trimmed.startsWith("{") && trimmed.endsWith("}")) ||
    (trimmed.startsWith("[") && trimmed.endsWith("]"))
  ) {
    try {
      return JSON.parse(trimmed);
    } catch {
      return value;
    }
  }
  return value;
}

function normalizeObjectKey(key: string): string {
  if (!key) return key;
  if (/^[a-z][a-zA-Z0-9]*$/.test(key)) return key;
  const normalized = key
    .replace(/[\s-]+/g, "_")
    .split("_")
    .filter(Boolean);
  if (normalized.length === 0) return key;
  const [head, ...tail] = normalized;
  return [
    head.toLowerCase(),
    ...tail.map(
      (segment) =>
        segment.charAt(0).toUpperCase() + segment.slice(1).toLowerCase()
    ),
  ].join("");
}

export function normalizeFeatureConfig(
  value: unknown
): FeatureFlagValue | undefined {
  if (typeof value === "undefined") return undefined;
  if (value === true) return true;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return parseRuntimeValue(value) as FeatureFlagValue;
  }

  const result: FeatureFlagConfig = {};
  Object.entries(value as Record<string, unknown>).forEach(([key, raw]) => {
    const normalizedKey = normalizeObjectKey(key);
    if (typeof raw !== "undefined") {
      result[normalizedKey] = normalizeFeatureConfig(raw) ?? raw;
    }
  });
  return result;
}

export function normalizeFeatureRegistry(
  value: unknown
): FeatureFlagRegistry {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.entries(value as Record<string, unknown>).reduce(
    (acc, [key, raw]) => {
      const normalizedKey = normalizeFeatureName(key);
      const normalizedValue = normalizeFeatureConfig(raw);
      if (typeof normalizedValue !== "undefined") {
        acc[normalizedKey] = normalizedValue;
      }
      return acc;
    },
    {} as FeatureFlagRegistry
  );
}

export function isFeatureFlagEnabled(value: FeatureFlagValue | undefined): boolean {
  if (value === true) return true;
  return !!value && typeof value === "object";
}

export function isFeatureFlagEnabledByName(
  registry: FeatureFlagRegistry | undefined,
  featureName: string
): boolean {
  return isFeatureFlagEnabled(registry?.[normalizeFeatureName(featureName)]);
}

export function normalizeFeatureRule(
  features: string[],
  match: FeatureFlagMatchMode = "any"
): FeatureFlagRule {
  return {
    features: [...new Set(features.map(normalizeFeatureName).filter(Boolean))],
    match,
  };
}

export function isFeatureRuleSatisfied(
  rule: FeatureFlagRule | undefined,
  registry: FeatureFlagRegistry | undefined
): boolean {
  if (!rule || rule.features.length === 0) return true;
  const enabled = rule.features.filter((feature) =>
    isFeatureFlagEnabledByName(registry, feature)
  );
  if (rule.match === "all") return enabled.length === rule.features.length;
  return enabled.length > 0;
}

export function isFeatureRuleBlocked(
  rule: FeatureFlagRule | undefined,
  registry: FeatureFlagRegistry | undefined
): boolean {
  if (!rule || rule.features.length === 0) return false;
  return rule.features.some((feature) => isFeatureFlagEnabledByName(registry, feature));
}

export function readMetadata<T = unknown>(
  target: object,
  key: string
): T | undefined {
  return Metadata.get(target as any, key) as T | undefined;
}

export function normalizeFeatureSubjectType(
  subjectType: FeatureFlagAccessSubjectType | string
): FeatureFlagAccessSubjectType {
  return subjectType.trim().toLowerCase() as FeatureFlagAccessSubjectType;
}

export function normalizeFeatureSubjectKey(subjectKey: string): string {
  return subjectKey.trim();
}
