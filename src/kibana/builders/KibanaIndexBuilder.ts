/**
 * @module integrations/kibana/builders/KibanaIndexBuilder
 * @summary Fluent builder for Kibana index pattern (data view) configurations.
 * @description Implements the project Builder Pattern (constitution §2):
 * extends `Model`, uses `@decaf-ts/decorator-validation` decorators, fluent
 * `setX(): this` methods, and a terminal `build()` that validates via
 * `hasErrors()` and returns a `KibanaDataViewConfig`.
 *
 * Supports three base matching modes:
 * - `EXACT` — single, fully-qualified index name (no wildcards).
 * - `PREFIX` — wildcard pattern (e.g. `filebeat-pla-demo-*`).
 * - `LOGGER_GENERATED` — derives index name segments from a log pattern
 *   compiled via `compileLogPattern()` and rendered via
 *   `logParameterRegistry.render()`.
 *
 * **Compounding:** Logger-generated segments can be compounded with ANY
 * base matching mode. When `logPattern` + `logPayload` are provided
 * alongside EXACT or PREFIX mode, the rendered segments are appended to
 * the base index name and a trailing `*` is added.
 */
import {
  list,
  Model,
  ModelArg,
  option,
  required,
  minlength,
} from "@decaf-ts/decorator-validation";
import { InternalError, ValidationError } from "@decaf-ts/db-decorators";
import { prop } from "@decaf-ts/decoration";
import {
  compileLogPattern,
  logParameterRegistry,
  type LogParameterPayload,
} from "@decaf-ts/logging";

import { KibanaDataViewConfig, KibanaIndexMatchMode } from "../types";

export class KibanaIndexBuilder extends Model {
  // ── Matching strategy ──
  @required()
  @option(KibanaIndexMatchMode)
  matchMode: KibanaIndexMatchMode = KibanaIndexMatchMode.PREFIX;

  // ── Index name segments ──
  @prop()
  @minlength(1)
  prefix?: string;

  @prop()
  @minlength(1)
  exactIndexName?: string;

  // ── Logger-generated compounding ──
  @prop()
  @minlength(1)
  logPattern?: string;

  @prop()
  logPayload?: Partial<LogParameterPayload>;

  // ── Separator ──
  @prop()
  separator: string = "-";

  // ── Data View fields (map to KibanaDataViewConfig) ──
  @required()
  @minlength(1)
  id: string = "";

  @required()
  @minlength(1)
  name: string = "";

  @prop()
  timeFieldName?: string;

  @prop()
  @list(() => String)
  namespaces?: string[];

  @prop()
  @list(() => Object)
  sourceFilters?: Array<{ value: string }>;

  @prop()
  runtimeFieldMap?: Record<string, unknown>;

  @prop()
  fieldAttrs?: Record<string, unknown>;

  @prop()
  allowNoIndex?: boolean;

  constructor(arg?: ModelArg<KibanaIndexBuilder>) {
    super(arg);
    Model.fromModel(this, arg);
  }

  // ── Fluent setters: matching strategy ──
  setMatchMode(mode: KibanaIndexMatchMode): this {
    this.matchMode = mode;
    return this;
  }

  setPrefix(prefix: string): this {
    this.prefix = prefix;
    return this;
  }

  setExactIndexName(name: string): this {
    this.exactIndexName = name;
    return this;
  }

  setLogPattern(pattern: string): this {
    this.logPattern = pattern;
    return this;
  }

  setLogPayload(payload: Partial<LogParameterPayload>): this {
    this.logPayload = payload;
    return this;
  }

  setSeparator(sep: string): this {
    this.separator = sep;
    return this;
  }

  // ── Fluent setters: data view fields ──
  setId(id: string): this {
    this.id = id;
    return this;
  }

  setName(name: string): this {
    this.name = name;
    return this;
  }

  setTimeFieldName(field: string): this {
    this.timeFieldName = field;
    return this;
  }

  setNamespaces(ns: string[]): this {
    this.namespaces = ns;
    return this;
  }

  setSourceFilters(
    filters: Array<{ value: string }>,
  ): this {
    this.sourceFilters = filters;
    return this;
  }

  setRuntimeFieldMap(map: Record<string, unknown>): this {
    this.runtimeFieldMap = map;
    return this;
  }

  setFieldAttrs(attrs: Record<string, unknown>): this {
    this.fieldAttrs = attrs;
    return this;
  }

  setAllowNoIndex(allow: boolean): this {
    this.allowNoIndex = allow;
    return this;
  }

  // ── Build ──
  build(): KibanaDataViewConfig {
    const errs = this.hasErrors();
    if (errs) throw new ValidationError(errs);

    const title = this.composeTitle();
    return {
      id: this.id,
      name: this.name,
      title,
      timeFieldName: this.timeFieldName,
      namespaces: this.namespaces,
      sourceFilters: this.sourceFilters,
      runtimeFieldMap: this.runtimeFieldMap,
      fieldAttrs: this.fieldAttrs,
      allowNoIndex: this.allowNoIndex,
    };
  }

  // ── Title composition ──
  protected composeTitle(): string {
    const baseSegments = this.composeBaseSegments();
    const loggerSegments = this.composeLoggerGeneratedSegments();

    if (loggerSegments.length > 0) {
      const allSegments = [...baseSegments, ...loggerSegments];
      return allSegments.join(this.separator) + this.separator + "*";
    }

    switch (this.matchMode) {
      case KibanaIndexMatchMode.EXACT:
        return baseSegments[0];
      case KibanaIndexMatchMode.PREFIX: {
        const base = baseSegments[0];
        return base.endsWith(this.separator)
          ? `${base}*`
          : `${base}${this.separator}*`;
      }
      case KibanaIndexMatchMode.LOGGER_GENERATED:
        if (baseSegments.length === 0) {
          throw new ValidationError([
            {
              property: "prefix",
              message:
                "prefix is required for LOGGER_GENERATED mode when no logPattern is set",
              constraints: {},
            },
          ]);
        }
        return baseSegments.join(this.separator) + this.separator + "*";
      default:
        throw new InternalError(
          `Unsupported match mode: ${this.matchMode}`,
        );
    }
  }

  protected composeBaseSegments(): string[] {
    switch (this.matchMode) {
      case KibanaIndexMatchMode.EXACT:
        if (
          !this.exactIndexName ||
          this.exactIndexName.trim().length === 0
        ) {
          throw new ValidationError([
            {
              property: "exactIndexName",
              message:
                "exactIndexName is required for EXACT match mode",
              constraints: {},
            },
          ]);
        }
        if (this.exactIndexName.includes("*")) {
          throw new ValidationError([
            {
              property: "exactIndexName",
              message:
                "exactIndexName must not contain wildcards (*) in EXACT match mode",
              constraints: {},
            },
          ]);
        }
        return [this.exactIndexName.trim()];
      case KibanaIndexMatchMode.PREFIX:
        if (!this.prefix || this.prefix.trim().length === 0) {
          throw new ValidationError([
            {
              property: "prefix",
              message:
                "prefix is required for PREFIX match mode",
              constraints: {},
            },
          ]);
        }
        return [this.prefix.trim()];
      case KibanaIndexMatchMode.LOGGER_GENERATED:
        return this.prefix && this.prefix.trim().length > 0
          ? [this.prefix.trim()]
          : [];
      default:
        throw new InternalError(
          `Unsupported match mode: ${this.matchMode}`,
        );
    }
  }

  protected composeLoggerGeneratedSegments(): string[] {
    if (!this.logPattern) return [];

    if (!this.logPayload) {
      throw new ValidationError([
        {
          property: "logPayload",
          message:
            "logPayload is required when logPattern is set",
          constraints: {},
        },
      ]);
    }

    const definition = compileLogPattern(this.logPattern);
    const fullPayload = this.buildFullPayload(this.logPayload);
    const rendered = logParameterRegistry.render(
      fullPayload,
      definition.keys,
    );

    const segments: string[] = [];
    for (const key of definition.keys) {
      const value = rendered[key];
      if (value && value.trim().length > 0) {
        segments.push(value.trim());
      }
    }

    if (
      segments.length === 0 &&
      this.matchMode === KibanaIndexMatchMode.LOGGER_GENERATED
    ) {
      throw new ValidationError([
        {
          property: "logPattern",
          message:
            "No segments were rendered from the provided logPattern and payload",
          constraints: {},
        },
      ]);
    }

    return segments;
  }

  /**
   * Fill missing LogParameterPayload fields with sensible defaults
   * so partial payloads can be accepted from the caller.
   */
  protected buildFullPayload(
    partial: Partial<LogParameterPayload>,
  ): LogParameterPayload {
    return {
      config: partial.config ?? ({} as any),
      level: partial.level ?? ("info" as any),
      context: partial.context ?? [],
      timestamp: partial.timestamp ?? new Date().toISOString(),
      app: partial.app ?? "",
      separator: partial.separator ?? this.separator,
      correlationId: partial.correlationId ?? "",
      rawMessage: partial.rawMessage ?? "",
      filteredMessage: partial.filteredMessage ?? "",
      meta: partial.meta,
      metaString: partial.metaString,
      stack: partial.stack,
      stackLabel: partial.stackLabel,
      applyTheme:
        partial.applyTheme ??
        ((value: string) => value),
    };
  }
}
