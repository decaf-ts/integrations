import {
  column,
  createdAt,
  oneToMany,
  pk,
  table,
  unique,
  updatedAt,
  uuid,
} from "@decaf-ts/core";
import {
  model,
  option,
  required,
  type as typeOf,
} from "@decaf-ts/decorator-validation";
import { IsolationTier, IsolationTierOptions } from "../types";
import { REL_RESTRICT } from "../utils";
import { AuthorizationModel } from "./authorization-model";
import { OrgUnit } from "./org-unit.model";
import { TenantMembership } from "./tenant-membership.model";
import { Principal } from "./principal.model";
import { StorageBinding } from "./storage-binding.model";

@table("tenants")
@model()
export class Tenant extends AuthorizationModel {
  constructor(data?: unknown) {
    super(data);
  }

  @pk({ type: String }) @uuid() id!: string;
  @unique() @required() @typeOf(String) @column() slug!: string;
  @required() @typeOf(String) @column() name!: string;
  @required()
  @typeOf(String)
  @option(IsolationTierOptions)
  @column()
  isolationTier!: IsolationTier;
  @oneToMany(() => OrgUnit, REL_RESTRICT, false) orgUnits?:
    | OrgUnit[]
    | string[];
  @oneToMany(() => TenantMembership, REL_RESTRICT, false) memberships?:
    | TenantMembership[]
    | string[];
  @oneToMany(() => Principal, REL_RESTRICT, false) principals?:
    | Principal[]
    | string[];
  @oneToMany(() => StorageBinding, REL_RESTRICT, false) storageBindings?:
    | StorageBinding[]
    | string[];
  @createdAt() createdAt!: Date;
  @updatedAt() updatedAt!: Date;
}
