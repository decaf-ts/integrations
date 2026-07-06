import { column, createdAt, manyToOne, oneToMany, pk, table, updatedAt, uuid } from "@decaf-ts/core";
import { model, option, required, type as typeOf } from "@decaf-ts/decorator-validation";
import { PrincipalKind, PrincipalKindOptions } from "../types";
import { REL_RESTRICT } from "../utils";
import { AuthorizationModel } from "./authorization-model";
import { Tenant } from "./tenant.model";
import { RoleAssignment } from "./role-assignment.model";
import { ResourceGrant } from "./resource-grant.model";

@table("principals")
@model()
export class Principal extends AuthorizationModel {
  constructor(data?: unknown) {
    super(data);
  }

  @pk({ type: String }) @uuid() id!: string;
  @manyToOne(() => Tenant, REL_RESTRICT, false, undefined, "fk_principals_tenant")
  @required()
  tenant!: Tenant | string;
  @required() @typeOf(String) @option(PrincipalKindOptions) @column() kind!: PrincipalKind;
  @required() @typeOf(String) @column() subjectId!: string;
  @oneToMany(() => RoleAssignment, REL_RESTRICT, false) roleAssignments?: RoleAssignment[] | string[];
  @oneToMany(() => ResourceGrant, REL_RESTRICT, false) resourceGrants?: ResourceGrant[] | string[];
  @createdAt() createdAt!: Date;
  @updatedAt() updatedAt!: Date;
}
