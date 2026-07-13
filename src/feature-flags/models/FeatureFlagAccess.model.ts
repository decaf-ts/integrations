import { BaseModel } from "@decaf-ts/core";
import { column, createdAt, pk, table, updatedAt, uuid } from "@decaf-ts/core";
import { model, required } from "@decaf-ts/decorator-validation";
import type { FeatureFlagAccessSubjectType } from "../types";

@table("feature_flag_access")
@model()
export class FeatureFlagAccess extends BaseModel {
  constructor(data?: Partial<FeatureFlagAccess>) {
    super(data);
  }

  @pk()
  @uuid()
  id!: string;

  @required()
  @column()
  featureKey!: string;

  @required()
  @column()
  subjectType!: FeatureFlagAccessSubjectType | string;

  @required()
  @column()
  subjectKey!: string;

  @column()
  enabled: boolean = true;

  @column()
  metadata?: Record<string, unknown>;

  @column()
  createdBy?: string;

  @column()
  updatedBy?: string;

  @createdAt()
  createdAt!: Date;

  @updatedAt()
  updatedAt!: Date;
}
