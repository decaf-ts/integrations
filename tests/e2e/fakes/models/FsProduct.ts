/**
 * @module integrations/e2e/fakes/models/FsProduct
 * @summary Admin-only model persisted by the FilesystemAdapter ("fs" flavour).
 * @description Mirrors {@link Product} but uses `@uses("fs")` so that
 * `DecafModule.forRootAsync` generates controllers for the `"fs"` flavour.
 * Has `@createdBy` / `@updatedBy` so the e2e test can verify that the
 * Keycloak user's email (extracted by the auth handler and accumulated onto
 * the context as `UUID`) reaches the persistence layer consistently across
 * both adapters.
 */
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
import { model, maxlength, minlength } from "@decaf-ts/decorator-validation";
import type { ModelArg } from "@decaf-ts/decorator-validation";

// "fs" flavour string — matches the FsAdapter's overridden flavour and the
// handlers registered by FilesystemAdapter.decoration()
const FsFlavour = "fs";

@uses(FsFlavour)
@table("fs_product")
@model()
@roles(["admin"])
export class FsProduct extends BaseModel {
  @pk({ type: "String", generated: false })
  id!: string;

  @column()
  @minlength(4)
  @maxlength(40)
  name!: string;

  @column()
  @createdBy()
  createdBy!: string;

  @column()
  @updatedBy()
  updatedBy!: string;

  constructor(args?: ModelArg<FsProduct>) {
    super(args);
  }
}
