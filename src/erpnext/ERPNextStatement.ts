import {
  Adapter,
  AdapterFlags,
  Condition,
  GroupOperator,
  Operator,
  OrderDirection,
  QueryError,
  SelectSelector,
  Statement,
} from "@decaf-ts/core";
import { InternalError } from "@decaf-ts/db-decorators";
import { Constructor, Metadata } from "@decaf-ts/decoration";
import { Model } from "@decaf-ts/decorator-validation";
import { ERPNextFilter, ERPNextOrderBy, RawERPNextQuery } from "./types";
import { ERPNextContext } from "./types";

/**
 * @description ERPNext-specific query statement builder
 * @summary Translates the core query contract into the two halves the ERPNext
 * adapter needs: server-side Frappe list controls (`filters`, `orderBy`, `select`)
 * and an in-memory predicate used to guarantee complex predicates stay correct.
 * The ERPNext/Frappe list API cannot express every condition, so conditions it
 * cannot represent are evaluated in memory by the adapter (and the server filters
 * are omitted rather than risking an incorrect page).
 * @template M - The model type being queried
 * @template R - The result type returned by the query
 * @template A - The ERPNext adapter type
 * @class ERPNextStatement
 * @category ERPNext
 * @example
 * ```typescript
 * const results = await adapter
 *   .Statement()
 *   .from(ERPNextCustomer)
 *   .where(Condition.attribute("customer_group").eq("Commercial"))
 *   .orderBy(["customer_name", "asc"])
 *   .limit(10)
 *   .execute();
 * ```
 */
export class ERPNextStatement<
  M extends Model,
  R,
  A extends Adapter<M, any, RawERPNextQuery<any>, ERPNextContext>,
> extends Statement<M, A, R, RawERPNextQuery<any>> {
  /**
   * @description Creates a statement bound to the ERPNext adapter
   * @param {A} adapter - The ERPNext adapter instance
   * @param {Partial<AdapterFlags>} [overrides] - Optional adapter flag overrides
   */
  constructor(adapter: A, overrides?: Partial<AdapterFlags>) {
    super(adapter, overrides);
  }

  /**
   * @description Builds the raw ERPNext query
   * @summary Assembles the select/from/where/filters/orderBy/limit/offset/groupBy
   * components and validates aggregation targets against the model metadata.
   * @return {RawERPNextQuery<any>} The constructed query
   */
  protected build(): RawERPNextQuery<any> {
    if (this.minSelector)
      this.ensureNumberOrDateSelector(this.minSelector, "MIN operation");
    if (this.maxSelector)
      this.ensureNumberOrDateSelector(this.maxSelector, "MAX operation");
    if (this.sumSelector)
      this.ensureNumericSelector(this.sumSelector, "SUM operation");
    if (this.avgSelector)
      this.ensureNumberOrDateSelector(this.avgSelector, "AVG operation");

    const parsedWhere = this.whereCondition
      ? this.parseCondition(this.whereCondition)
      : undefined;
    const result: RawERPNextQuery<M> = {
      select: this.selectSelector,
      from: this.fromSelector,
      where: parsedWhere?.where ?? (() => true),
      filters: parsedWhere?.filters ?? [],
      limit: this.limitSelector,
      skip: this.offsetSelector,
      groupBy: this.groupBySelectors,
    };

    if (this.orderBySelectors?.length)
      result.orderBy = this.orderBySelectors.map(
        ([field, direction]) =>
          ({
            field: field as string,
            direction:
              String(direction).toLowerCase() === OrderDirection.DSC
                ? "desc"
                : "asc",
          }) as ERPNextOrderBy
      );
    if (typeof this.countSelector !== "undefined")
      result.count = this.countSelector;
    if (this.countDistinctSelector)
      result.countDistinct = this.countDistinctSelector;
    if (this.minSelector) result.min = this.minSelector;
    if (this.maxSelector) result.max = this.maxSelector;
    if (this.sumSelector) result.sum = this.sumSelector;
    if (this.avgSelector) result.avg = this.avgSelector;
    if (this.distinctSelector) result.distinct = this.distinctSelector;
    return result as RawERPNextQuery<any>;
  }

  /**
   * @description Parses a condition into a raw ERPNext query fragment
   * @summary Produces both the in-memory predicate and the Frappe filter rows, as
   * the core `Statement` contract expects a raw query from `parseCondition`.
   * @param {Condition<M>} condition - The condition to parse
   * @return {RawERPNextQuery<any>} The query fragment
   */
  protected parseCondition(condition: Condition<M>): RawERPNextQuery<any> {
    return {
      from: this.fromSelector,
      where: this.parsePredicate(condition),
      filters: this.parseFilters(condition),
    } as RawERPNextQuery<any>;
  }

  /**
   * @description Parses a condition into an in-memory predicate
   * @summary Supports the standard comparison operators, AND/OR groups, NOT and the
   * type-sensitive operators used by the core query API.
   * @param {Condition<M>} condition - The condition to parse
   * @return {function(Model): boolean} The predicate
   */
  protected parsePredicate(
    condition: Condition<M>
  ): (el: Model) => boolean {
    return (m: Model) => {
      const { attr1, operator, comparison } = condition as unknown as {
        attr1: string | Condition<M>;
        operator: Operator | GroupOperator;
        comparison: any;
      };

      if (operator === Operator.NOT) {
        if (!(attr1 instanceof Condition))
          throw new InternalError(
            "NOT operator requires a nested condition to negate"
          );
        return !this.parsePredicate(attr1 as Condition<M>)(m);
      }

      if (operator === GroupOperator.AND || operator === GroupOperator.OR) {
        const left = this.parsePredicate(attr1 as Condition<M>)(m);
        const right = this.parsePredicate(comparison as Condition<M>)(m);
        return operator === GroupOperator.AND ? left && right : left || right;
      }

      const key = attr1 as keyof Model;
      const value = m[key];
      switch (operator) {
        case Operator.BIGGER:
          return value > comparison;
        case Operator.BIGGER_EQ:
          return value >= comparison;
        case Operator.DIFFERENT:
          return value !== comparison;
        case Operator.EQUAL:
          return value === comparison;
        case Operator.SMALLER:
          return value < comparison;
        case Operator.SMALLER_EQ:
          return value <= comparison;
        case Operator.IN:
          if (!Array.isArray(comparison))
            throw new QueryError(
              `IN operator requires an array, got: ${typeof comparison}`
            );
          return comparison.includes(value);
        case Operator.REGEXP: {
          const regexValue = value as unknown;
          if (typeof regexValue !== "string")
            throw new QueryError(
              `Invalid regexp comparison on a non string attribute: ${String(regexValue)}`
            );
          return !!regexValue.match(new RegExp(comparison, "g"));
        }
        case Operator.STARTS_WITH: {
          const startsValue = value as unknown;
          if (typeof startsValue !== "string" || typeof comparison !== "string")
            throw new QueryError(
              "STARTS_WITH operator requires string attribute and comparison"
            );
          return startsValue.startsWith(comparison);
        }
        case Operator.ENDS_WITH: {
          const endsValue = value as unknown;
          if (typeof endsValue !== "string" || typeof comparison !== "string")
            throw new QueryError(
              "ENDS_WITH operator requires string attribute and comparison"
            );
          return endsValue.endsWith(comparison);
        }
        case Operator.BETWEEN: {
          if (!Array.isArray(comparison) || comparison.length !== 2)
            throw new QueryError(
              `BETWEEN operator requires an array with 2 values [min, max], got: ${JSON.stringify(comparison)}`
            );
          const [min, max] = comparison;
          return value >= min && value <= max;
        }
        case Operator.EXISTS: {
          const present = value !== undefined && value !== null;
          return comparison === false ? !present : present;
        }
        default:
          throw new InternalError(
            `Invalid operator for standard comparisons: ${operator}`
          );
      }
    };
  }

  /**
   * @description Parses a condition into Frappe filter rows
   * @summary Returns `undefined` when the condition cannot be represented by a
   * flat Frappe filter list (OR, NOT, regexp). The adapter then reads the full
   * matching set and applies the in-memory predicate, rather than asking the
   * server for an incorrect subset.
   * @param {Condition<M>} condition - The condition to translate
   * @return {ERPNextFilter[] | undefined} The filter rows, when representable
   */
  protected parseFilters(
    condition: Condition<M>
  ): ERPNextFilter[] | undefined {
    const { attr1, operator, comparison } = condition as unknown as {
      attr1: string | Condition<M>;
      operator: Operator | GroupOperator;
      comparison: any;
    };

    if (operator === GroupOperator.AND) {
      const left = this.parseFilters(attr1 as Condition<M>);
      const right = this.parseFilters(comparison as Condition<M>);
      if (!left || !right) return undefined;
      return [...left, ...right];
    }

    if (
      operator === GroupOperator.OR ||
      operator === Operator.NOT ||
      operator === Operator.REGEXP
    )
      return undefined;

    const field = attr1 as string;
    switch (operator) {
      case Operator.EQUAL:
        return [[field, "=", comparison]];
      case Operator.DIFFERENT:
        return [[field, "!=", comparison]];
      case Operator.BIGGER:
        return [[field, ">", comparison]];
      case Operator.BIGGER_EQ:
        return [[field, ">=", comparison]];
      case Operator.SMALLER:
        return [[field, "<", comparison]];
      case Operator.SMALLER_EQ:
        return [[field, "<=", comparison]];
      case Operator.IN:
        if (!Array.isArray(comparison)) return undefined;
        return [[field, "in", comparison]];
      case Operator.BETWEEN:
        if (!Array.isArray(comparison) || comparison.length !== 2)
          return undefined;
        return [[field, "between", comparison]];
      case Operator.STARTS_WITH:
        return typeof comparison === "string"
          ? [[field, "like", `${comparison}%`]]
          : undefined;
      case Operator.ENDS_WITH:
        return typeof comparison === "string"
          ? [[field, "like", `%${comparison}`]]
          : undefined;
      case Operator.EXISTS:
        return [[field, "is", comparison === false ? "not set" : "set"]];
      default:
        return undefined;
    }
  }

  /**
   * @description Asserts an aggregate selector targets a numeric attribute
   * @summary Guards aggregation clauses such as `SUM`, rejecting attributes whose
   * resolved metadata type is not numeric.
   * @param {SelectSelector<M>} selector - The attribute selector to validate
   * @param {string} context - Aggregate name used in the error message
   * @return {void}
   */
  private ensureNumericSelector(
    selector: SelectSelector<M>,
    context: string
  ): void {
    this.ensureSelectorType(
      selector,
      context,
      (type) => this.isNumericType(type),
      "numeric"
    );
  }

  /**
   * @description Asserts an aggregate selector targets a numeric or date attribute
   * @summary Used by `MIN`/`MAX`/`AVG`, which accept both numbers and dates but
   * reject string or boolean attributes.
   * @param {SelectSelector<M>} selector - The attribute selector to validate
   * @param {string} context - Aggregate name used in the error message
   * @return {void}
   */
  private ensureNumberOrDateSelector(
    selector: SelectSelector<M>,
    context: string
  ): void {
    this.ensureSelectorType(
      selector,
      context,
      (type) => this.isNumericType(type) || type === "date",
      "numeric or date"
    );
  }

  /**
   * @description Resolves an aggregate selector type and applies a predicate
   * @summary Shared validation routine for the aggregate guards. It requires a
   * target model to be set and throws {@link InternalError} or {@link QueryError}
   * when the selector cannot be resolved or fails the predicate.
   * @param {SelectSelector<M>} selector - The attribute selector to validate
   * @param {string} context - Aggregate name used in the error messages
   * @param {function(string): boolean} predicate - Allowed type predicate
   * @param {string} description - Human readable allowed types for the error
   * @return {void}
   */
  private ensureSelectorType(
    selector: SelectSelector<M>,
    context: string,
    predicate: (type: string) => boolean,
    description: string
  ): void {
    if (!this.fromSelector)
      throw new InternalError(
        `${context} requires a target model. Call from() before aggregating.`
      );
    const attribute = selector as string;
    const type = this.determineAttributeType(
      this.fromSelector,
      attribute as keyof Model<false>,
      context
    );
    if (!predicate(type))
      throw new QueryError(
        `${context} requires a ${description} attribute, but "${attribute}" is ${type || "unknown"}`
      );
  }

  /**
   * @description Resolves the metadata type of a model attribute
   * @summary Reads the decorated type from {@link Metadata}, falling back to the
   * reflected design type, and throws {@link QueryError} when nothing resolves.
   * @param {Constructor<Model>} clazz - The model constructor
   * @param {string} attribute - The attribute name
   * @param {string} context - Aggregate name used in the error message
   * @return {string} The normalized, lower-cased type name
   */
  private determineAttributeType(
    clazz: Constructor<Model>,
    attribute: string,
    context: string
  ): string {
    const propKey = attribute as keyof Model<false>;
    const metaType =
      Metadata.type(clazz, propKey) ??
      Metadata.getPropDesignTypes(clazz, propKey)?.designType;
    const resolved = this.normalizeMetaType(metaType);
    if (!resolved)
      throw new QueryError(
        `${context} could not resolve property type for "${attribute}"`
      );
    return resolved;
  }

  /**
   * @description Normalizes a metadata type descriptor to its lower-case name
   * @param {unknown} metaType - The metadata type (string or constructor)
   * @return {string|undefined} The normalized type name, or `undefined`
   */
  private normalizeMetaType(metaType: unknown): string | undefined {
    if (!metaType) return undefined;
    if (typeof metaType === "string") return metaType.toLowerCase();
    if (typeof metaType === "function" && metaType.name)
      return metaType.name.toLowerCase();
    return undefined;
  }

  /**
   * @description Checks whether a normalized type name is numeric
   * @param {string} [type] - The normalized type name
   * @return {boolean} `true` for `number` and `bigint`
   */
  private isNumericType(type?: string): boolean {
    return type === "number" || type === "bigint";
  }
}
