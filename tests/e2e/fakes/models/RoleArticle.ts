/**
 * @module integrations/e2e/fakes/models/RoleArticle
 * @summary Model for per-operation role e2e tests (reader/writer/admin).
 * @description Has NO @roles() decorator and NO @controllerConfig — the
 * generated controller falls through to Auth(ModelConstr) which sets
 * AUTH_META_KEY + UseInterceptors(AuthInterceptor) at class level.
 * Per-route auth is then applied in the test via the for-nest @Public()
 * and @RequireRoles() decorator functions:
 *   - read / findBy           → @Public()               (no token)
 *   - readAll / findOneBy / …  → @RequireRoles("reader")
 *   - create / update         → @RequireRoles("writer")
 *   - delete                  → @RequireRoles("admin")
 */
import { uses } from "@decaf-ts/decoration";
import { BaseModel, column, createdBy, pk, table, updatedBy } from "@decaf-ts/core";
// @ts-expect-error ram
import { RamFlavour } from "@decaf-ts/core/ram";
import {
  maxlength,
  minlength,
  model,
  pattern,
} from "@decaf-ts/decorator-validation";
import type { ModelArg } from "@decaf-ts/decorator-validation";

@uses(RamFlavour)
@table("role_article")
@model()
export class RoleArticle extends BaseModel {
  @pk({ type: String, generated: false })
  id!: string;

  @column()
  @minlength(3)
  @maxlength(40)
  title!: string;

  @column()
  @minlength(3)
  body!: string;

  @column()
  @pattern(/^[a-zA-Z0-9/-]{1,20}$/)
  category!: string;

  @column()
  @createdBy()
  createdBy!: string;

  @column()
  @updatedBy()
  updatedBy!: string;

  constructor(args?: ModelArg<RoleArticle>) {
    super(args);
  }
}
