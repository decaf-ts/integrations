import { column, createdAt, manyToOne, pk, table, uuid } from "@decaf-ts/core";
import { model, required, type as typeOf } from "@decaf-ts/decorator-validation";
import { REL_CASCADE_DEPENDENT } from "../utils";
import { AuthorizationModel } from "./authorization-model";
import { Tenant } from "./tenant.model";
import { OrgUnit } from "./org-unit.model";

@table("org_unit_closure")
@model()
export class OrgUnitClosure extends AuthorizationModel {
  constructor(data?: unknown) {
    super(data);
  }

  @pk({ type: String }) @uuid() id!: string;
  @manyToOne(() => Tenant, REL_CASCADE_DEPENDENT, false, undefined, "fk_org_closure_tenant")
  @required()
  tenant!: Tenant | string;
  @manyToOne(() => OrgUnit, REL_CASCADE_DEPENDENT, false, undefined, "fk_org_closure_ancestor")
  @required()
  ancestor!: OrgUnit | string;
  @manyToOne(() => OrgUnit, REL_CASCADE_DEPENDENT, false, undefined, "fk_org_closure_descendant")
  @required()
  descendant!: OrgUnit | string;
  @required() @typeOf(Number) @column() depth!: number;
  @createdAt() createdAt!: Date;
}
