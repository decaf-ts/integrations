import {
  column,
  createdAt,
  manyToOne,
  pk,
  table,
  updatedAt,
  uuid,
} from "@decaf-ts/core";
import { description } from "@decaf-ts/decoration";
import {
  model,
  option,
  required,
  type as typeOf,
} from "@decaf-ts/decorator-validation";
import {
  CredentialProvider,
  CredentialProviderOptions,
} from "../types";
import { REL_NULLIFY, REL_RESTRICT } from "../utils";
import { AuthorizationModel } from "./authorization-model";
import { Tenant } from "./tenant.model";
import { OrgUnit } from "./org-unit.model";
import { Principal } from "./principal.model";

@table("credentials")
@model()
@description(
  "Namespaced credential metadata record referencing an encrypted secret value"
)
export class Credential extends AuthorizationModel {
  @pk({ type: String })
  @uuid()
  id!: string;

  @manyToOne(
    () => Tenant,
    REL_RESTRICT,
    false,
    undefined,
    "fk_credentials_tenant"
  )
  @required()
  tenant!: Tenant | string;

  @manyToOne(
    () => OrgUnit,
    REL_NULLIFY,
    false,
    undefined,
    "fk_credentials_org_unit"
  )
  orgUnit?: OrgUnit | string;

  @manyToOne(
    () => Principal,
    REL_NULLIFY,
    false,
    undefined,
    "fk_credentials_owner"
  )
  owner?: Principal | string;

  @required()
  @typeOf(String)
  @column()
  name!: string;

  @required()
  @typeOf(String)
  @column()
  credentialType!: string;

  @required()
  @typeOf(String)
  @column()
  secretName!: string;

  @required()
  @typeOf(String)
  @option(CredentialProviderOptions)
  @column()
  provider!: CredentialProvider;

  @typeOf(String)
  @column()
  description?: string;

  @typeOf(Boolean)
  @column()
  enabled: boolean = true;

  @typeOf(Object)
  @column()
  metadata?: Record<string, unknown>;

  @column()
  expiresAt?: Date;

  @column()
  lastUsedAt?: Date;

  @createdAt()
  createdAt!: Date;

  @updatedAt()
  updatedAt!: Date;

  constructor(data?: unknown) {
    super(data);
  }
}
