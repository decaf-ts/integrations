import { column, createdAt, manyToOne, pk, table, updatedAt, uuid } from "@decaf-ts/core";
import { model, option, required, type as typeOf } from "@decaf-ts/decorator-validation";
import { MembershipStatus, MembershipStatusOptions } from "../types";
import { REL_CASCADE_DEPENDENT } from "../utils";
import { AuthorizationModel } from "./authorization-model";
import { Tenant } from "./tenant.model";
import { User } from "./user.model";

@table("tenant_memberships")
@model()
export class TenantMembership extends AuthorizationModel {
  constructor(data?: unknown) {
    super(data);
  }

  @pk({ type: String }) @uuid() id!: string;
  @manyToOne(() => Tenant, REL_CASCADE_DEPENDENT, false, undefined, "fk_tenant_memberships_tenant")
  @required()
  tenant!: Tenant | string;
  @manyToOne(() => User, REL_CASCADE_DEPENDENT, false, undefined, "fk_tenant_memberships_user")
  @required()
  user!: User | string;
  @required() @typeOf(String) @option(MembershipStatusOptions) @column() status!: MembershipStatus;
  @createdAt() createdAt!: Date;
  @updatedAt() updatedAt!: Date;
}
