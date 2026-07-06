import { column, createdAt, manyToOne, pk, table, updatedAt, uuid } from "@decaf-ts/core";
import { model, required, type as typeOf } from "@decaf-ts/decorator-validation";
import { REL_CASCADE_DEPENDENT, REL_RESTRICT } from "../utils";
import { AuthorizationModel } from "./authorization-model";
import { Tenant } from "./tenant.model";
import { Principal } from "./principal.model";
import { ProtectedResource } from "./protected-resource.model";

@table("resource_grants")
@model()
export class ResourceGrant extends AuthorizationModel {
  constructor(data?: unknown) {
    super(data);
  }

  @pk({ type: String }) @uuid() id!: string;
  @manyToOne(() => Tenant, REL_CASCADE_DEPENDENT, false, undefined, "fk_resource_grants_tenant")
  @required()
  tenant!: Tenant | string;
  @manyToOne(() => ProtectedResource, REL_CASCADE_DEPENDENT, false, undefined, "fk_resource_grants_resource")
  @required()
  resource!: ProtectedResource | string;
  @manyToOne(() => Principal, REL_CASCADE_DEPENDENT, false, undefined, "fk_resource_grants_principal")
  @required()
  principal!: Principal | string;
  @required() @typeOf(String) @column() permissionKey!: string;
  @column() startsAt?: Date;
  @column() expiresAt?: Date;
  @typeOf(Object) @column() conditions?: Record<string, unknown>;
  @manyToOne(() => Principal, REL_RESTRICT, false, undefined, "fk_resource_grants_created_by")
  createdBy?: Principal | string;
  @createdAt() createdAt!: Date;
  @updatedAt() updatedAt!: Date;
}
