export type FeatureFlagMatchMode = "any" | "all";
export type FeatureFlagAccessSubjectType =
  | "user"
  | "account"
  | "namespace"
  | "model"
  | "route"
  | "ui";

export interface FeatureFlagRule {
  features: string[];
  match?: FeatureFlagMatchMode;
}

export interface FeatureFlagConfig {
  enabled?: boolean;
  description?: string;
  metadata?: Record<string, unknown>;
  scope?: string;
  targets?: string[];
  [key: string]: unknown;
}

export type FeatureFlagValue = boolean | FeatureFlagConfig;

export type FeatureFlagRegistry = Record<string, FeatureFlagValue>;

export interface FeatureFlagEnvironmentShape {
  featureFlag?: FeatureFlagRegistry;
}

export interface FeatureFlagAccessSubject {
  subjectType: FeatureFlagAccessSubjectType;
  subjectKey: string;
}

export interface FeatureFlagAccessInput extends FeatureFlagAccessSubject {
  featureKey: string;
  enabled?: boolean;
  metadata?: Record<string, unknown>;
}

export interface FeatureFlagAccessQuery extends FeatureFlagAccessSubject {
  featureKeys?: string[];
  enabled?: boolean;
}

export interface FeatureFlagReaderInput {
  source?: FeatureFlagEnvironmentShape | unknown;
  [key: string]: unknown;
}

export interface FeatureFlagReaderConfig {
  readerConfig?: FeatureFlagReaderInput;
}
