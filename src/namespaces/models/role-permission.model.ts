import { createdAt, manyToOne, pk, table, uuid } from "@decaf-ts/core";
import { model, required } from "@decaf-ts/decorator-validation";
import { REL_CASCADE_DEPENDENT } from "../utils";
import { AuthorizationModel } from "./authorization-model";
import { Role } from "./role.model";
import { Permission } from "./permission.model";

@table("role_permissions")
@model()
export class RolePermission extends AuthorizationModel {
  constructor(data?: unknown) {
    super(data);
  }

  @pk({ type: String }) @uuid() id!: string;
  @manyToOne(() => Role, REL_CASCADE_DEPENDENT, false, undefined, "fk_role_permissions_role")
  @required()
  role!: Role | string;
  @manyToOne(() => Permission, REL_CASCADE_DEPENDENT, false, undefined, "fk_role_permissions_permission")
  @required()
  permission!: Permission | string;
  @createdAt() createdAt!: Date;
}
