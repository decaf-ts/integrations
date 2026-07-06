import { column, createdAt, manyToOne, pk, table, uuid } from "@decaf-ts/core";
import { model, option, required, type as typeOf } from "@decaf-ts/decorator-validation";
import { ScopeKind, ScopeKindOptions } from "../types";
import { REL_CASCADE_DEPENDENT } from "../utils";
import { AuthorizationModel } from "./authorization-model";
import { Tenant } from "./tenant.model";
import { Principal } from "./principal.model";

@table("effective_permissions")
@model()
export class EffectivePermission extends AuthorizationModel {
  constructor(data?: unknown) {
    super(data);
  }

  @pk({ type: String }) @uuid() id!: string;
  @manyToOne(() => Tenant, REL_CASCADE_DEPENDENT, false, undefined, "fk_effective_permissions_tenant")
  @required()
  tenant!: Tenant | string;
  @manyToOne(() => Principal, REL_CASCADE_DEPENDENT, false, undefined, "fk_effective_permissions_principal")
  @required()
  principal!: Principal | string;
  @required() @typeOf(String) @column() permissionKey!: string;
  @required() @typeOf(String) @option(ScopeKindOptions) @column() scopeKind!: ScopeKind;
  @required() @typeOf(String) @column() scopeId!: string;
  @required() @typeOf(String) @column() sourceKind!: string;
  @required() @typeOf(String) @column() sourceId!: string;
  @column() startsAt?: Date;
  @column() expiresAt?: Date;
  @createdAt() createdAt!: Date;
}
