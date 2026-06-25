import { uses } from "@decaf-ts/decoration";
import {
  BaseModel,
  column,
  createdBy,
  pk,
  table,
  updatedBy,
  roles,
} from "@decaf-ts/core";
// @ts-expect-error ram
import { RamFlavour } from "@decaf-ts/core/ram";
import {
  maxlength,
  minlength,
  model,
  pattern,
} from "@decaf-ts/decorator-validation";
import type { ModelArg } from "@decaf-ts/decorator-validation";
import { composed, readonly } from "@decaf-ts/db-decorators";

/**
 * Admin-only model. @roles(["admin"]) means only tokens with the "admin"
 * role can access its CRUD endpoints.
 */
@uses(RamFlavour)
@table("product")
@model()
@roles(["admin"])
export class Product extends BaseModel {
  @pk({ type: "String", generated: false })
  @composed(["productCode", "batchNumber"], ":", true)
  id!: string;

  @column()
  @minlength(14)
  @maxlength(14)
  @readonly()
  productCode!: string;

  @column()
  @readonly()
  @pattern(/^[a-zA-Z0-9/-]{1,20}$/)
  batchNumber!: string;

  @column()
  name!: string;

  @column()
  @createdBy()
  createdBy!: string;

  @column()
  @updatedBy()
  updatedBy!: string;

  constructor(args?: ModelArg<Product>) {
    super(args);
  }
}
