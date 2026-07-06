import { column, createdAt, manyToOne, oneToMany, pk, table, updatedAt, uuid } from "@decaf-ts/core";
import { model, required, type as typeOf } from "@decaf-ts/decorator-validation";
import { REL_RESTRICT } from "../utils";
import { AuthorizationModel } from "./authorization-model";
import { Tenant } from "./tenant.model";
import { OrgUnitMembership } from "./org-unit-membership.model";
import { OrgUnitClosure } from "./org-unit-closure.model";
import { ProtectedResource } from "./protected-resource.model";
import { InheritanceBlock } from "./inheritance-block.model";

@table("org_units")
@model()
export class OrgUnit extends AuthorizationModel {
  constructor(data?: unknown) {
    super(data);
  }

  @pk({ type: String }) @uuid() id!: string;
  @manyToOne(() => Tenant, REL_RESTRICT, false, undefined, "fk_org_units_tenant")
  @required()
  tenant!: Tenant | string;
  @manyToOne(() => OrgUnit, REL_RESTRICT, false, undefined, "fk_org_units_parent")
  parent?: OrgUnit | string;
  @oneToMany(() => OrgUnit, REL_RESTRICT, false) children?: OrgUnit[] | string[];
  @required() @typeOf(String) @column() name!: string;
  @required() @typeOf(String) @column() path!: string;
  @typeOf(Object) @column() metadata?: Record<string, unknown>;
  @oneToMany(() => OrgUnitMembership, REL_RESTRICT, false) memberships?: OrgUnitMembership[] | string[];
  @oneToMany(() => ProtectedResource, REL_RESTRICT, false) resources?: ProtectedResource[] | string[];
  @oneToMany(() => InheritanceBlock, REL_RESTRICT, false) inheritanceBlocks?: InheritanceBlock[] | string[];
  @oneToMany(() => OrgUnitClosure, REL_RESTRICT, false) ancestorLinks?: OrgUnitClosure[] | string[];
  @oneToMany(() => OrgUnitClosure, REL_RESTRICT, false) descendantLinks?: OrgUnitClosure[] | string[];
  @createdAt() createdAt!: Date;
  @updatedAt() updatedAt!: Date;
}
