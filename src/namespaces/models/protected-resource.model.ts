import { column, createdAt, manyToOne, oneToMany, pk, table, updatedAt, uuid } from "@decaf-ts/core";
import { model, option, required, type as typeOf } from "@decaf-ts/decorator-validation";
import { REL_NULLIFY, REL_RESTRICT } from "../utils";
import { ResourceVisibility, ResourceVisibilityOptions } from "../types";
import { AuthorizationModel } from "./authorization-model";
import { Tenant } from "./tenant.model";
import { OrgUnit } from "./org-unit.model";
import { Principal } from "./principal.model";
import { ResourceGrant } from "./resource-grant.model";

@table("protected_resources")
@model()
export class ProtectedResource extends AuthorizationModel {
  constructor(data?: unknown) {
    super(data);
  }

  @pk({ type: String }) @uuid() id!: string;
  @manyToOne(() => Tenant, REL_RESTRICT, false, undefined, "fk_protected_resources_tenant")
  @required()
  tenant!: Tenant | string;
  @manyToOne(() => OrgUnit, REL_RESTRICT, false, undefined, "fk_protected_resources_org_unit")
  @required()
  orgUnit!: OrgUnit | string;
  @required() @typeOf(String) @column() resourceType!: string;
  @required() @typeOf(String) @column() resourceId!: string;
  @required() @typeOf(String) @option(ResourceVisibilityOptions) @column() visibility!: ResourceVisibility;
  @manyToOne(() => Principal, REL_NULLIFY, false, undefined, "fk_protected_resources_owner")
  owner?: Principal | string;
  @typeOf(String) @column() sensitivity?: string;
  @typeOf(Object) @column() metadata?: Record<string, unknown>;
  @oneToMany(() => ResourceGrant, REL_RESTRICT, false) grants?: ResourceGrant[] | string[];
  @createdAt() createdAt!: Date;
  @updatedAt() updatedAt!: Date;
}
