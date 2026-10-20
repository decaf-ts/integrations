import { description } from "@decaf-ts/decoration";
import { BaseModel } from "@decaf-ts/core";
import {
  column,
  createdAt,
  pk,
  table,
  updatedAt,
  uuid,
  unique,
} from "@decaf-ts/core";
import { model, required } from "@decaf-ts/decorator-validation";
import type { FeatureFlagConfig } from "../types";

@description("Persisted feature flag definition used for runtime evaluation")
@table("feature_flags")
@model()
export class FeatureFlag extends BaseModel {
  constructor(data?: Partial<FeatureFlag>) {
    super(data);
  }

  @pk()
  @uuid()
  id!: string;

  @unique()
  @required()
  @column()
  key!: string;

  @column()
  enabled: boolean = true;

  @column()
  description?: string;

  @column()
  scope?: string;

  @column()
  metadata?: Record<string, unknown>;

  @column()
  config?: FeatureFlagConfig;

  @column()
  createdBy?: string;

  @column()
  updatedBy?: string;

  @createdAt()
  createdAt!: Date;

  @updatedAt()
  updatedAt!: Date;
}
