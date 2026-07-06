import { column, createdAt, manyToOne, pk, table, updatedAt, uuid } from "@decaf-ts/core";
import { model, option, required, type as typeOf } from "@decaf-ts/decorator-validation";
import { StorageBindingKind, StorageBindingKindOptions, StorageKind, StorageKindOptions } from "../types";
import { REL_CASCADE_DEPENDENT } from "../utils";
import { AuthorizationModel } from "./authorization-model";
import { Tenant } from "./tenant.model";

@table("storage_bindings")
@model()
export class StorageBinding extends AuthorizationModel {
  constructor(data?: unknown) {
    super(data);
  }

  @pk({ type: String }) @uuid() id!: string;
  @manyToOne(() => Tenant, REL_CASCADE_DEPENDENT, false, undefined, "fk_storage_bindings_tenant")
  @required()
  tenant!: Tenant | string;
  @required() @typeOf(String) @option(StorageKindOptions) @column() storageKind!: StorageKind;
  @required() @typeOf(String) @option(StorageBindingKindOptions) @column() bindingKind!: StorageBindingKind;
  @required() @typeOf(String) @column() bindingKey!: string;
  @required() @typeOf(String) @column() region!: string;
  @typeOf(Object) @column() config?: Record<string, unknown>;
  @createdAt() createdAt!: Date;
  @updatedAt() updatedAt!: Date;
}
