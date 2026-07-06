import { column, createdAt, manyToOne, pk, table, updatedAt, uuid } from "@decaf-ts/core";
import { model, required, type as typeOf } from "@decaf-ts/decorator-validation";
import { REL_CASCADE_DEPENDENT } from "../utils";
import { AuthorizationModel } from "./authorization-model";
import { OrgUnit } from "./org-unit.model";

@table("org_unit_profiles")
@model()
export class OrgUnitProfile extends AuthorizationModel {
  constructor(data?: unknown) {
    super(data);
  }

  @pk({ type: String }) @uuid() id!: string;
  @manyToOne(() => OrgUnit, REL_CASCADE_DEPENDENT, false, undefined, "fk_org_unit_profiles_org_unit")
  @required()
  orgUnit!: OrgUnit | string;
  @required() @typeOf(String) @column() profileKey!: string;
  @typeOf(Object) @column() metadata?: Record<string, unknown>;
  @createdAt() createdAt!: Date;
  @updatedAt() updatedAt!: Date;
}
