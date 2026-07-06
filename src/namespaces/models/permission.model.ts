import { column, oneToMany, pk, table, unique, uuid } from "@decaf-ts/core";
import { model, option, required, type as typeOf } from "@decaf-ts/decorator-validation";
import { PermissionCategory, PermissionCategoryOptions } from "../types";
import { REL_RESTRICT } from "../utils";
import { AuthorizationModel } from "./authorization-model";
import { RolePermission } from "./role-permission.model";

@table("permissions")
@model()
export class Permission extends AuthorizationModel {
  constructor(data?: unknown) {
    super(data);
  }

  @pk({ type: String }) @uuid() id!: string;
  @unique() @required() @typeOf(String) @column() key!: string;
  @required() @typeOf(String) @option(PermissionCategoryOptions) @column() category!: PermissionCategory;
  @typeOf(String) @column() description?: string;
  @oneToMany(() => RolePermission, REL_RESTRICT, false) rolePermissions?: RolePermission[] | string[];
}
