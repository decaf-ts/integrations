import { column, createdAt, manyToOne, pk, table, updatedAt, uuid } from "@decaf-ts/core";
import { model, option, required, type as typeOf } from "@decaf-ts/decorator-validation";
import { ScopeKind, ScopeKindOptions } from "../types";
import { REL_CASCADE_DEPENDENT, REL_RESTRICT } from "../utils";
import { AuthorizationModel } from "./authorization-model";
import { Tenant } from "./tenant.model";
import { Principal } from "./principal.model";
import { Role } from "./role.model";

@table("role_assignments")
@model()
export class RoleAssignment extends AuthorizationModel {
  constructor(data?: unknown) {
    super(data);
  }

  @pk({ type: String }) @uuid() id!: string;
  @manyToOne(() => Tenant, REL_CASCADE_DEPENDENT, false, undefined, "fk_role_assignments_tenant")
  @required()
  tenant!: Tenant | string;
  @manyToOne(() => Principal, REL_CASCADE_DEPENDENT, false, undefined, "fk_role_assignments_principal")
  @required()
  principal!: Principal | string;
  @manyToOne(() => Role, REL_RESTRICT, false, undefined, "fk_role_assignments_role")
  @required()
  role!: Role | string;
  @required() @typeOf(String) @option(ScopeKindOptions) @column() scopeKind!: ScopeKind;
  @required() @typeOf(String) @column() scopeId!: string;
  @required() @typeOf(Boolean) @column() inheritDown!: boolean;
  @column() startsAt?: Date;
  @column() expiresAt?: Date;
  @typeOf(Object) @column() conditions?: Record<string, unknown>;
  @createdAt() createdAt!: Date;
  @updatedAt() updatedAt!: Date;
}
