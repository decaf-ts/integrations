/**
 * @module integrations/kibana/builders/KibanaIndexBuilderCollection
 * @summary Collection builder for multiple Kibana data views.
 * @description Provides a fluent chain for building multiple
 * `KibanaDataViewConfig` objects in one call, directly consumable by
 * `KibanaDataViewService.createDataViews()`.
 */
import { Model, ModelArg } from "@decaf-ts/decorator-validation";
import { ValidationError } from "@decaf-ts/db-decorators";

import { KibanaDataViewConfig } from "../types";
import { KibanaIndexBuilder } from "./KibanaIndexBuilder";

export class KibanaIndexBuilderCollection extends Model {
  builders: KibanaIndexBuilder[] = [];

  constructor(arg?: ModelArg<KibanaIndexBuilderCollection>) {
    super(arg);
    Model.fromModel(this, arg);
  }

  static for(
    ...builders: KibanaIndexBuilder[]
  ): KibanaIndexBuilderCollection {
    const collection = new KibanaIndexBuilderCollection();
    collection.builders = builders;
    return collection;
  }

  add(builder: KibanaIndexBuilder): this {
    this.builders.push(builder);
    return this;
  }

  build(): KibanaDataViewConfig[] {
    const errs = this.hasErrors();
    if (errs) throw new ValidationError(errs);
    return this.builders.map((b) => b.build());
  }
}
