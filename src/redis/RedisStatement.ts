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
import { RedisContext, RawRedisQuery } from "./types";
import { Model } from "@decaf-ts/decorator-validation";
import { InternalError } from "@decaf-ts/db-decorators";
import { Constructor, Metadata } from "@decaf-ts/decoration";

/**
 * @description Redis-specific query statement builder
 * @summary Extends the base Statement class to provide query building functionality for the Redis adapter.
 * This class translates high-level query operations into predicates that can filter and sort
 * in-memory data structures (records reverted from the table hash).
 * @template M - The model type being queried
 * @template R - The result type returned by the query
 * @class RedisStatement
 * @category Redis
 * @example
 * ```typescript
 * // Create a statement for querying User models
 * const statement = redisAdapter.Statement<User>();
 *
 * // Build a query to find active users with age > 18
 * const results = await statement
 *   .from(User)
 *   .where(Condition.and(
 *     Condition.eq('active', true),
 *     Condition.gt('age', 18)
 *   ))
 *   .orderBy('lastName', 'asc')
 *   .limit(10)
 *   .execute();
 * ```
 */
export class RedisStatement<
  M extends Model,
  R,
  A extends Adapter<M, any, RawRedisQuery<any>, RedisContext>,
> extends Statement<M, A, R, RawRedisQuery<any>> {
  /**
   * @description Creates a statement bound to the Redis adapter
   * @param {A} adapter - The Redis adapter instance to use for executing queries
   * @param {Partial<AdapterFlags>} [overrides] - Optional adapter flag overrides
   */
  constructor(adapter: A, overrides?: Partial<AdapterFlags>) {
    super(adapter, overrides);
  }

  /**
   * @description Creates a sort comparator function
   * @summary Generates a function that compares two model instances based on the orderBy criteria.
   * This method handles different data types (string, number, date) and sort directions (asc, desc).
   * @return {function(Model, Model): number} A comparator function for sorting model instances
   */
  private getSort() {
    const selectors = this.orderBySelectors;
    return (el1: Model, el2: Model) => {
      if (!selectors || !selectors.length)
        throw new InternalError(
          "orderBySelectors not set. Should be impossible"
        );
      for (const [key, direction] of selectors) {
        const normalizedDirection = String(direction).toLowerCase();
        const directionFactor =
          normalizedDirection === OrderDirection.ASC ? 1 : -1;
        const comparison = this.compareByKey(el1, el2, key as keyof Model);
        if (comparison !== 0) return directionFactor * comparison;
      }
      return 0;
    };
  }

  /**
   * @description Compares two models by a single attribute
   * @summary Resolves the attribute's design type and delegates to the matching
   * type-specific comparator.
   * @param {Model} el1 - The first model instance
   * @param {Model} el2 - The second model instance
   * @param {keyof Model} key - The attribute to compare
   * @return {number} A negative number, zero or a positive number as per the comparison
   */
  private compareByKey(el1: Model, el2: Model, key: keyof Model): number {
    const value1 = el1[key];
    const value2 = el2[key];

    if (value1 === value2) return 0;

    if (value1 == null || value2 == null) return value1 == null ? 1 : -1;

    const { designType: type } = Metadata.getPropDesignTypes(
      el1.constructor as any,
      key as string
    );
    const resolvedType =
      (type && type.name && type.name.toLowerCase()) || typeof value1;

    switch (resolvedType) {
      case "string":
        return this.compareStrings(
          value1 as unknown as string,
          value2 as unknown as string
        );
      case "number":
        return this.compareNumbers(
          value1 as unknown as number,
          value2 as unknown as number
        );
      case "bigint":
        return this.compareBigInts(
          value1 as unknown as bigint,
          value2 as unknown as bigint
        );
      case "boolean":
        return this.compareBooleans(
          value1 as unknown as boolean,
          value2 as unknown as boolean
        );
      case "date":
      case "object":
        if (value1 instanceof Date && value2 instanceof Date) {
          return this.compareDates(value1 as Date, value2 as Date);
        }
        break;
      default:
        break;
    }

    throw new QueryError(`sorting not supported for type ${resolvedType}`);
  }

  /**
   * @description Compares two boolean values
   * @return {number} 0 when equal, 1 when `a` is true, -1 otherwise
   */
  private compareBooleans(a: boolean, b: boolean): number {
    return a === b ? 0 : a ? 1 : -1;
  }

  /**
   * @description Compares two numeric values
   * @return {number} The numeric difference between the values
   */
  private compareNumbers(a: number, b: number): number {
    return a - b;
  }

  /**
   * @description Compares two bigint values
   * @return {number} 0 when equal, 1 when `a` is greater, -1 otherwise
   */
  private compareBigInts(a: bigint, b: bigint): number {
    if (a === b) return 0;
    return a > b ? 1 : -1;
  }

  /**
   * @description Compares two strings using locale-aware ordering
   * @return {number} The locale compare result between the values
   */
  private compareStrings(a: string, b: string): number {
    return a.localeCompare(b);
  }

  /**
   * @description Compares two dates by their epoch timestamps
   * @return {number} The difference between the timestamps
   */
  private compareDates(a: Date, b: Date): number {
    return a.valueOf() - b.valueOf();
  }

  /**
   * @description Builds a Redis query from the statement
   * @summary Converts the statement's selectors and conditions into a RawRedisQuery object
   * that can be executed by the Redis adapter. This method assembles all query components
   * (select, from, where, limit, offset, sort) into the final query structure.
   * @return {RawRedisQuery<M>} The constructed Redis query object
   */
  protected build(): RawRedisQuery<any> {
    if (this.minSelector)
      this.ensureNumberOrDateSelector(this.minSelector, "MIN operation");
    if (this.maxSelector)
      this.ensureNumberOrDateSelector(this.maxSelector, "MAX operation");
    if (this.sumSelector)
      this.ensureNumericSelector(this.sumSelector, "SUM operation");
    if (this.avgSelector)
      this.ensureNumberOrDateSelector(this.avgSelector, "AVG operation");

    const result: RawRedisQuery<M> = {
      select: this.selectSelector,
      from: this.fromSelector,
      where: this.whereCondition
        ? this.parseCondition(this.whereCondition).where
        : // eslint-disable-next-line @typescript-eslint/no-unused-vars
          (el: M) => {
            return true;
          },
      limit: this.limitSelector,
      skip: this.offsetSelector,
      groupBy: this.groupBySelectors,
    };

    if (typeof this.countSelector !== "undefined") result.count = this.countSelector;
    if (this.countDistinctSelector) result.countDistinct = this.countDistinctSelector;
    if (this.minSelector) result.min = this.minSelector;
    if (this.maxSelector) result.max = this.maxSelector;
    if (this.sumSelector) result.sum = this.sumSelector;
    if (this.avgSelector) result.avg = this.avgSelector;
    if (this.distinctSelector) result.distinct = this.distinctSelector;
    if (this.orderBySelectors?.length) result.sort = this.getSort();
    return result as RawRedisQuery<any>;
  }

  /**
   * @description Parses a condition into a Redis query predicate
   * @summary Converts a Condition object into a predicate function that can be used
   * to filter model instances in memory. This method handles both simple conditions
   * (equals, greater than, etc.) and complex conditions with logical operators (AND, OR).
   * @template M - The model type for the condition
   * @param {Condition<M>} condition - The condition to parse
   * @return {RawRedisQuery<M>} A Redis query object with a where predicate function
   * @mermaid
   * sequenceDiagram
   *   participant Caller
   *   participant RedisStatement
   *   participant SimpleCondition
   *   participant ComplexCondition
   *
   *   Caller->>RedisStatement: parseCondition(condition)
   *   alt Simple condition (eq, gt, lt, etc.)
   *     RedisStatement->>SimpleCondition: Extract attr1, operator, comparison
   *     SimpleCondition-->>RedisStatement: Return predicate function
   *   else Logical operator (AND, OR)
   *     RedisStatement->>ComplexCondition: Extract nested conditions
   *     RedisStatement->>RedisStatement: parseCondition(leftCondition)
   *     RedisStatement->>RedisStatement: parseCondition(rightCondition)
   *     ComplexCondition-->>RedisStatement: Combine predicates with logical operator
   *   end
   *   RedisStatement-->>Caller: Return query with where predicate
   */
  protected parseCondition(condition: Condition<M>): RawRedisQuery<any> {
    return {
      where: (m: Model) => {
        const { attr1, operator, comparison } = condition as unknown as {
          attr1: string | Condition<M>;
          operator: Operator | GroupOperator;
          comparison: any;
        };

        if (
          [GroupOperator.AND, GroupOperator.OR, Operator.NOT].indexOf(
            operator as GroupOperator
          ) === -1
        ) {
          switch (operator) {
            case Operator.BIGGER:
              return m[attr1 as keyof Model] > comparison;
            case Operator.BIGGER_EQ:
              return m[attr1 as keyof Model] >= comparison;
            case Operator.DIFFERENT:
              return m[attr1 as keyof Model] !== comparison;
            case Operator.EQUAL:
              return m[attr1 as keyof Model] === comparison;
            case Operator.REGEXP:
              if (typeof m[attr1 as keyof Model] !== "string")
                throw new QueryError(
                  `Invalid regexp comparison on a non string attribute: ${m[attr1 as keyof Model]}`
                );
              return !!(m[attr1 as keyof Model] as unknown as string).match(
                new RegExp(comparison, "g")
              );
            case Operator.STARTS_WITH: {
              const attr = attr1 as keyof Model;
              const attrName = attr as string;
              const attrValue = m[attr] as unknown;
              if (typeof attrValue !== "string") {
                throw new QueryError(
                  `Invalid startsWith comparison on a non string attribute "${attrName}"`
                );
              }
              if (typeof comparison !== "string") {
                throw new QueryError(
                  `STARTS_WITH operator requires a string comparison, got ${typeof comparison}`
                );
              }
              return (attrValue as string).startsWith(comparison);
            }
            case Operator.ENDS_WITH: {
              const attr = attr1 as keyof Model;
              const attrName = attr as string;
              const attrValue = m[attr] as unknown;
              if (typeof attrValue !== "string") {
                throw new QueryError(
                  `Invalid endsWith comparison on a non string attribute "${attrName}"`
                );
              }
              if (typeof comparison !== "string") {
                throw new QueryError(
                  `ENDS_WITH operator requires a string comparison, got ${typeof comparison}`
                );
              }
              return (attrValue as string).endsWith(comparison);
            }
            case Operator.SMALLER:
              return m[attr1 as keyof Model] < comparison;
            case Operator.SMALLER_EQ:
              return m[attr1 as keyof Model] <= comparison;
            case Operator.IN:
              if (!Array.isArray(comparison))
                throw new QueryError(
                  `IN operator requires an array, got: ${typeof comparison}`
                );
              return comparison.includes(m[attr1 as keyof Model]);
            case Operator.BETWEEN: {
              if (!Array.isArray(comparison) || comparison.length !== 2)
                throw new QueryError(
                  `BETWEEN operator requires an array with 2 values [min, max], got: ${JSON.stringify(
                    comparison
                  )}`
                );
              const attr = attr1 as keyof Model;
              const attrName = attr as string;
              const attrType = this.determineAttributeType(
                m.constructor as Constructor<Model>,
                attrName,
                "BETWEEN"
              );
              if (!this.isNumericType(attrType) && attrType !== "date") {
                throw new QueryError(
                  `BETWEEN operator requires numeric or date attributes, but "${attrName}" is ${attrType ||
                    "unknown"}`
                );
              }
              const [min, max] = comparison;
              const value = m[attr];
              const comparableValue = this.toComparableValue(
                value,
                attrType,
                attrName,
                "BETWEEN",
                { allowNull: true }
              );
              if (comparableValue === null) return false;
              const minComparable = this.toComparableValue(
                min,
                attrType,
                attrName,
                "BETWEEN min"
              )!;
              const maxComparable = this.toComparableValue(
                max,
                attrType,
                attrName,
                "BETWEEN max"
              )!;
              return (
                comparableValue >= minComparable && comparableValue <= maxComparable
              );
            }
            case Operator.EXISTS: {
              const present =
                m[attr1 as keyof Model] !== undefined &&
                m[attr1 as keyof Model] !== null;
              return comparison === false ? !present : present;
            }
            default:
              throw new InternalError(
                `Invalid operator for standard comparisons: ${operator}`
              );
          }
        } else if (operator === Operator.NOT) {
          if (!(attr1 instanceof Condition)) {
            throw new InternalError(
              "NOT operator requires a nested condition to negate"
            );
          }
          const nested = this.parseCondition(attr1 as Condition<M>);
          return !nested.where(m);
        } else {
          const op1: RawRedisQuery<any> = this.parseCondition(
            attr1 as Condition<M>
          );
          const op2: RawRedisQuery<any> = this.parseCondition(
            comparison as Condition<M>
          );
          switch (operator) {
            case GroupOperator.AND:
              return op1.where(m) && op2.where(m);
            case GroupOperator.OR:
              return op1.where(m) || op2.where(m);
            default:
              throw new InternalError(
                `Invalid operator for And/Or comparisons: ${operator}`
              );
          }
        }
      },
    } as RawRedisQuery<any>;
  }

  /**
   * @description Validates that an aggregation selector targets a numeric attribute
   * @param {SelectSelector<M>} selector - The attribute selector to validate
   * @param {string} context - The aggregation context used in error messages
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
   * @description Validates that an aggregation selector targets a numeric or date attribute
   * @param {SelectSelector<M>} selector - The attribute selector to validate
   * @param {string} context - The aggregation context used in error messages
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
   * @description Validates that a selector's attribute type satisfies a predicate
   * @summary Resolves the attribute type from the model metadata and raises a
   * `QueryError` when the type does not match the expected kind.
   * @param {SelectSelector<M>} selector - The attribute selector to validate
   * @param {string} context - The aggregation context used in error messages
   * @param {function(string): boolean} predicate - Type acceptance predicate
   * @param {string} description - Human readable description of the accepted types
   * @return {void}
   */
  private ensureSelectorType(
    selector: SelectSelector<M>,
    context: string,
    predicate: (type: string) => boolean,
    description: string
  ) {
    if (!this.fromSelector) {
      throw new InternalError(
        `${context} requires a target model. Call from() before aggregating.`
      );
    }
    const attr = selector as string;
    const type = this.determineAttributeType(
      this.fromSelector,
      attr as keyof Model<false>,
      context
    );

    if (!predicate(type)) {
      throw new QueryError(
        `${context} requires a ${description} attribute, but "${attr}" is ${type || "unknown"}`
      );
    }
  }

  /**
   * @description Resolves the attribute type from the model metadata
   * @summary Reads the metadata or design type of the attribute and normalizes it
   * to a lowercase type name.
   * @param {Constructor<Model>} clazz - The model constructor
   * @param {string} attr - The attribute name
   * @param {string} context - The context used in error messages
   * @return {string} The normalized attribute type
   */
  private determineAttributeType(
    clazz: Constructor<Model>,
    attr: string,
    context: string
  ): string {
    const propKey = attr as keyof Model<false>;
    const metaType =
      Metadata.type(clazz, propKey) ??
      Metadata.getPropDesignTypes(clazz, propKey)?.designType;
    const resolved = this.normalizeMetaType(metaType);
    if (!resolved) {
      throw new QueryError(
        `${context} could not resolve property type for "${attr}"`
      );
    }
    return resolved;
  }

  /**
   * @description Normalizes a raw metadata type to a lowercase type name
   * @param {any} metaType - The raw metadata type value
   * @return {string | undefined} The normalized type name, when resolvable
   */
  private normalizeMetaType(metaType: any): string | undefined {
    if (!metaType) return undefined;
    if (typeof metaType === "string") return metaType.toLowerCase();
    if (typeof metaType === "function" && metaType.name)
      return metaType.name.toLowerCase();
    return undefined;
  }

  /**
   * @description Whether the given type name is a numeric type
   * @param {string} [type] - The normalized type name
   * @return {boolean} True for "number" and "bigint"
   */
  private isNumericType(type?: string): boolean {
    return type === "number" || type === "bigint";
  }

  /**
   * @description Converts a value to a numeric comparable value
   * @summary Maps date, number and bigint values to numbers for comparison and
   * raises a `QueryError` for missing or incompatible values.
   * @param {any} value - The value to convert
   * @param {string} attrType - The normalized attribute type
   * @param {string} attrName - The attribute name used in error messages
   * @param {string} context - The context used in error messages
   * @param {object} [options] - Conversion options
   * @param {boolean} [options.allowNull] - Whether null/undefined values return null instead of raising
   * @return {number | null} The numeric comparable value
   */
  private toComparableValue(
    value: any,
    attrType: string,
    attrName: string,
    context: string,
    options?: { allowNull?: boolean }
  ): number | null {
    if (value == null) {
      if (options?.allowNull) return null;
      throw new QueryError(`${context} requires a value for "${attrName}"`);
    }
    switch (attrType) {
      case "date":
        if (!(value instanceof Date)) {
          throw new QueryError(
            `${context} on date attribute "${attrName}" requires Date values`
          );
        }
        return value.getTime();
      case "number":
        if (typeof value !== "number") {
          throw new QueryError(
            `${context} on numeric attribute "${attrName}" requires number values`
          );
        }
        return value;
      case "bigint":
        if (typeof value === "number") return value;
        if (typeof value === "bigint") return Number(value);
        throw new QueryError(
          `${context} on bigint attribute "${attrName}" requires numeric values`
        );
      default:
        throw new QueryError(
          `${context} unsupported type "${attrType}" for attribute "${attrName}"`
        );
    }
  }
}
