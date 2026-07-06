import { column, createdAt, manyToOne, pk, table, uuid } from "@decaf-ts/core";
import { model, required, type as typeOf } from "@decaf-ts/decorator-validation";
import { REL_CASCADE_DEPENDENT } from "../utils";
import { AuthorizationModel } from "./authorization-model";
import { Tenant } from "./tenant.model";
import { Group } from "./group.model";
import { Principal } from "./principal.model";

@table("group_memberships")
@model()
export class GroupMembership extends AuthorizationModel {
  constructor(data?: unknown) {
    super(data);
  }

  @pk({ type: String }) @uuid() id!: string;
  @manyToOne(() => Tenant, REL_CASCADE_DEPENDENT, false, undefined, "fk_group_memberships_tenant")
  @required()
  tenant!: Tenant | string;
  @manyToOne(() => Group, REL_CASCADE_DEPENDENT, false, undefined, "fk_group_memberships_group")
  @required()
  group!: Group | string;
  @manyToOne(() => Principal, REL_CASCADE_DEPENDENT, false, undefined, "fk_group_memberships_principal")
  @required()
  principal!: Principal | string;
  @typeOf(Object) @column() metadata?: Record<string, unknown>;
  @createdAt() createdAt!: Date;
}
