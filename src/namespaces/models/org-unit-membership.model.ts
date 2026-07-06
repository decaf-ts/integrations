import { column, createdAt, manyToOne, pk, table, updatedAt, uuid } from "@decaf-ts/core";
import { model, option, required, type as typeOf } from "@decaf-ts/decorator-validation";
import { MembershipStatus, MembershipStatusOptions } from "../types";
import { REL_CASCADE_DEPENDENT, REL_RESTRICT } from "../utils";
import { AuthorizationModel } from "./authorization-model";
import { Tenant } from "./tenant.model";
import { OrgUnit } from "./org-unit.model";
import { User } from "./user.model";

@table("org_unit_memberships")
@model()
export class OrgUnitMembership extends AuthorizationModel {
  constructor(data?: unknown) {
    super(data);
  }

  @pk({ type: String }) @uuid() id!: string;
  @manyToOne(() => Tenant, REL_CASCADE_DEPENDENT, false, undefined, "fk_org_memberships_tenant")
  @required()
  tenant!: Tenant | string;
  @manyToOne(() => OrgUnit, REL_CASCADE_DEPENDENT, false, undefined, "fk_org_memberships_org_unit")
  @required()
  orgUnit!: OrgUnit | string;
  @manyToOne(() => User, REL_RESTRICT, false, undefined, "fk_org_memberships_user")
  @required()
  user!: User | string;
  @required() @typeOf(String) @option(MembershipStatusOptions) @column() status!: MembershipStatus;
  @createdAt() createdAt!: Date;
  @updatedAt() updatedAt!: Date;
}
