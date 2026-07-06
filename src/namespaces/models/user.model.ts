import { column, createdAt, oneToMany, pk, table, unique, updatedAt, uuid } from "@decaf-ts/core";
import { model, required, type as typeOf } from "@decaf-ts/decorator-validation";
import { REL_RESTRICT } from "../utils";
import { AuthorizationModel } from "./authorization-model";
import { TenantMembership } from "./tenant-membership.model";
import { OrgUnitMembership } from "./org-unit-membership.model";

@table("users")
@model()
export class User extends AuthorizationModel {
  constructor(data?: unknown) {
    super(data);
  }

  @pk({ type: String }) @uuid() id!: string;
  @unique() @typeOf(String) @column() email?: string;
  @unique() @typeOf(String) @column() phone?: string;
  @required() @typeOf(String) @column() displayName!: string;
  @oneToMany(() => TenantMembership, REL_RESTRICT, false) tenantMemberships?: TenantMembership[] | string[];
  @oneToMany(() => OrgUnitMembership, REL_RESTRICT, false) orgUnitMemberships?: OrgUnitMembership[] | string[];
  @createdAt() createdAt!: Date;
  @updatedAt() updatedAt!: Date;
}
