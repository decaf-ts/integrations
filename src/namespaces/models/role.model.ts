import { column, createdAt, manyToOne, oneToMany, pk, table, updatedAt, uuid } from "@decaf-ts/core";
import { model, required, type as typeOf } from "@decaf-ts/decorator-validation";
import { REL_NULLIFY, REL_RESTRICT } from "../utils";
import { AuthorizationModel } from "./authorization-model";
import { Tenant } from "./tenant.model";
import { RolePermission } from "./role-permission.model";
import { RoleAssignment } from "./role-assignment.model";

@table("roles")
@model()
export class Role extends AuthorizationModel {
  constructor(data?: unknown) {
    super(data);
  }

  @pk({ type: String }) @uuid() id!: string;
  @manyToOne(() => Tenant, REL_NULLIFY, false, undefined, "fk_roles_tenant")
  tenant?: Tenant | string;
  @required() @typeOf(String) @column() key!: string;
  @required() @typeOf(String) @column() name!: string;
  @typeOf(String) @column() description?: string;
  @typeOf(Object) @column() metadata?: Record<string, unknown>;
  @oneToMany(() => RolePermission, REL_RESTRICT, false) rolePermissions?: RolePermission[] | string[];
  @oneToMany(() => RoleAssignment, REL_RESTRICT, false) assignments?: RoleAssignment[] | string[];
  @createdAt() createdAt!: Date;
  @updatedAt() updatedAt!: Date;
}
