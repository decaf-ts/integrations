import { column, createdAt, manyToOne, oneToMany, pk, table, updatedAt, uuid } from "@decaf-ts/core";
import { model, required, type as typeOf } from "@decaf-ts/decorator-validation";
import { REL_NULLIFY, REL_RESTRICT } from "../utils";
import { AuthorizationModel } from "./authorization-model";
import { Tenant } from "./tenant.model";
import { OrgUnit } from "./org-unit.model";
import { GroupMembership } from "./group-membership.model";

@table("groups")
@model()
export class Group extends AuthorizationModel {
  constructor(data?: unknown) {
    super(data);
  }

  @pk({ type: String }) @uuid() id!: string;
  @manyToOne(() => Tenant, REL_RESTRICT, false, undefined, "fk_groups_tenant")
  @required()
  tenant!: Tenant | string;
  @manyToOne(() => OrgUnit, REL_NULLIFY, false, undefined, "fk_groups_org_unit")
  orgUnit?: OrgUnit | string;
  @required() @typeOf(String) @column() name!: string;
  @typeOf(Object) @column() metadata?: Record<string, unknown>;
  @oneToMany(() => GroupMembership, REL_RESTRICT, false) members?: GroupMembership[] | string[];
  @createdAt() createdAt!: Date;
  @updatedAt() updatedAt!: Date;
}
