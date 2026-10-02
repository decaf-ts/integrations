import type { ModelArg } from "@decaf-ts/decorator-validation";
import { min, model, pattern, required } from "@decaf-ts/decorator-validation";
import { BaseModel, pk, table } from "@decaf-ts/core";
import { uses } from "@decaf-ts/decoration";
import { RedisFlavour } from "../../src/redis";

@uses(RedisFlavour)
@table("tst_redis_country")
@model()
export class RedisCountryModel extends BaseModel {
  @pk({ type: Number, generated: false })
  id!: number;

  @required()
  name!: string;

  @required()
  countryCode!: string;

  @required()
  @pattern(/[a-z]{2}(?:_[A-Z]{2})?/g)
  locale!: string;

  constructor(m?: ModelArg<RedisCountryModel>) {
    super(m);
  }
}

@uses(RedisFlavour)
@table("tst_redis_person")
@model()
export class RedisPersonModel extends BaseModel {
  @pk({ type: Number, generated: false })
  id!: number;

  @required()
  name!: string;

  @required()
  age!: number;

  @required()
  active!: boolean;

  @required()
  score!: number;

  constructor(m?: ModelArg<RedisPersonModel>) {
    super(m);
  }
}

@uses(RedisFlavour)
@table("tst_redis_temporal")
@model()
export class RedisTemporalModel extends BaseModel {
  @pk({ type: Number, generated: false })
  id!: number;

  @required()
  name!: string;

  @required()
  when!: Date;

  @required()
  big!: bigint;

  constructor(m?: ModelArg<RedisTemporalModel>) {
    super(m);
  }
}

@uses(RedisFlavour)
@table("tst_redis_ordered")
@model()
export class RedisOrderedModel extends BaseModel {
  @pk({ type: Number, generated: false })
  id!: number;

  @required()
  @min(0)
  group!: string;

  @required()
  rank!: number;

  @required()
  label!: string;

  constructor(m?: ModelArg<RedisOrderedModel>) {
    super(m);
  }
}

export function countries(count = 5): RedisCountryModel[] {
  return Array.from(
    { length: count },
    (_, i) =>
      new RedisCountryModel({
        id: i + 1,
        name: `country${i + 1}`,
        countryCode: "pt",
        locale: "pt_PT",
      })
  );
}

export function people(): RedisPersonModel[] {
  return [
    new RedisPersonModel({
      id: 1,
      name: "alice",
      age: 30,
      active: true,
      score: 1.5,
    }),
    new RedisPersonModel({
      id: 2,
      name: "bob",
      age: 20,
      active: false,
      score: 2.5,
    }),
    new RedisPersonModel({
      id: 3,
      name: "carol",
      age: 40,
      active: true,
      score: 3.5,
    }),
    new RedisPersonModel({
      id: 4,
      name: "dave",
      age: 10,
      active: false,
      score: 4.5,
    }),
  ];
}

export function ordered(): RedisOrderedModel[] {
  return [
    new RedisOrderedModel({ id: 1, group: "a", rank: 3, label: "delta" }),
    new RedisOrderedModel({ id: 2, group: "a", rank: 1, label: "bravo" }),
    new RedisOrderedModel({ id: 3, group: "a", rank: 2, label: "alpha" }),
    new RedisOrderedModel({ id: 4, group: "b", rank: 1, label: "charlie" }),
    new RedisOrderedModel({ id: 5, group: "b", rank: 2, label: "echo" }),
  ];
}
