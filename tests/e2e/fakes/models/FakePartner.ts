import { uses } from "@decaf-ts/decoration";
import { BaseModel, column, createdBy, pk, roles, table } from "@decaf-ts/core";
// @ts-expect-error ram
import { RamFlavour } from "@decaf-ts/core/ram";
import { model, required } from "@decaf-ts/decorator-validation";
import type { ModelArg } from "@decaf-ts/decorator-validation";

/**
 * Partner-only model. @roles(["partner"]) means only tokens with the "partner"
 * role can access its CRUD endpoints.
 */
@uses(RamFlavour)
@table("fake_partner")
@roles(["partner"])
@model()
export class FakePartner extends BaseModel {
  @pk({ type: String, generated: false })
  id!: string;

  @column()
  @required()
  name!: string;

  @column()
  @createdBy()
  createdBy!: string;

  constructor(args?: ModelArg<FakePartner>) {
    super(args);
  }
}
