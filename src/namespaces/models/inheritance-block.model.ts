import { column, createdAt, manyToOne, pk, table, updatedAt, uuid } from "@decaf-ts/core";
import { model, option, required, type as typeOf } from "@decaf-ts/decorator-validation";
import { PermissionCategory, PermissionCategoryOptions } from "../types";
import { REL_CASCADE_DEPENDENT, REL_NULLIFY } from "../utils";
import { AuthorizationModel } from "./authorization-model";
import { Tenant } from "./tenant.model";
import { OrgUnit } from "./org-unit.model";

@table("inheritance_blocks")
@model()
export class InheritanceBlock extends AuthorizationModel {
  constructor(data?: unknown) {
    super(data);
  }

  @pk({ type: String }) @uuid() id!: string;
  @manyToOne(() => Tenant, REL_CASCADE_DEPENDENT, false, undefined, "fk_inheritance_blocks_tenant")
  @required()
  tenant!: Tenant | string;
  @manyToOne(() => OrgUnit, REL_CASCADE_DEPENDENT, false, undefined, "fk_inheritance_blocks_org_unit")
  @required()
  orgUnit!: OrgUnit | string;
  @manyToOne(() => OrgUnit, REL_NULLIFY, false, undefined, "fk_inheritance_blocks_blocked_ancestor")
  blockedFromAncestor?: OrgUnit | string;
  @required() @typeOf(String) @option(PermissionCategoryOptions) @column() permissionCategory!: PermissionCategory;
  @typeOf(String) @column() reason?: string;
  @createdAt() createdAt!: Date;
  @updatedAt() updatedAt!: Date;
}
