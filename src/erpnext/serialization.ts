import { Metadata, type Constructor } from "@decaf-ts/decoration";
import { Model } from "@decaf-ts/decorator-validation";

const ERPNextRawDateTime = Symbol.for("decaf.erpnext.rawDateTime");

interface ERPNextRawDateTimeValue {
  value: string;
  time: number;
}

function attachRawDateTime(value: Date, raw: string): Date {
  Object.defineProperty(value, ERPNextRawDateTime, {
    value: { value: raw, time: value.getTime() } as ERPNextRawDateTimeValue,
    enumerable: false,
    configurable: true,
    writable: true,
  });
  return value;
}

function rawDateTime(value: Date): ERPNextRawDateTimeValue | undefined {
  const raw = (value as unknown as Record<symbol, unknown>)[
    ERPNextRawDateTime
  ] as ERPNextRawDateTimeValue | undefined;
  if (!raw || raw.time !== value.getTime()) return undefined;
  return raw;
}

/**
 * @description Formats a date as an ERPNext `Date` value
 * @summary Frappe expects `YYYY-MM-DD` for date fields. The conversion is done in
 * UTC so the serialized day does not drift with the host timezone.
 * @param {Date} value - The date to format
 * @return {string} The ERPNext date string
 * @function formatERPNextDate
 * @memberOf module:erpnext
 */
export function formatERPNextDate(value: Date): string {
  return value.toISOString().slice(0, 10);
}

/**
 * @description Formats a date as an ERPNext `Datetime` value
 * @summary Frappe expects `YYYY-MM-DD HH:mm:ss` for datetime fields.
 * @param {Date} value - The date to format
 * @return {string} The ERPNext datetime string
 * @function formatERPNextDateTime
 * @memberOf module:erpnext
 */
export function formatERPNextDateTime(value: Date): string {
  const raw = rawDateTime(value);
  if (raw) return raw.value;
  return value.toISOString().slice(0, 19).replace("T", " ");
}

/**
 * @description Encodes a single JavaScript value for an ERPNext payload
 * @summary Dates become ERPNext datetime strings and bigints become decimal
 * strings (JSON cannot represent either). Arrays and plain objects are encoded
 * recursively so nested child tables keep their formatting.
 * @param {unknown} value - The value to encode
 * @return {unknown} The encoded value
 * @function encodeERPNextValue
 * @memberOf module:erpnext
 */
export function encodeERPNextValue(value: unknown): unknown {
  if (value instanceof Date) return formatERPNextDateTime(value);
  if (typeof value === "boolean") return value ? 1 : 0;
  if (typeof value === "bigint") return value.toString();
  if (Array.isArray(value)) return value.map(encodeERPNextValue);
  if (value && typeof value === "object") {
    if (typeof (value as { toJSON?: unknown }).toJSON === "function")
      return encodeERPNextValue(
        (value as { toJSON: () => unknown }).toJSON()
      );
    return Object.entries(value as Record<string, unknown>).reduce(
      (accum, [key, val]) => {
        accum[key] = encodeERPNextValue(val);
        return accum;
      },
      {} as Record<string, unknown>
    );
  }
  return value;
}

/**
 * @description Serializes a prepared record for ERPNext
 * @summary Applies {@link encodeERPNextValue} to every field of the record while
 * preserving non-enumerable persistence metadata.
 * @param {Record<string, any>} record - The prepared record
 * @return {Record<string, any>} The ERPNext-ready record
 * @function serializeERPNextRecord
 * @memberOf module:erpnext
 */
export function serializeERPNextRecord(
  record: Record<string, any>
): Record<string, any> {
  return Object.entries(record).reduce(
    (accum, [key, value]) => {
      if (typeof value !== "undefined") accum[key] = encodeERPNextValue(value);
      return accum;
    },
    {} as Record<string, any>
  );
}

/**
 * @description Parses an ERPNext date or datetime value
 * @summary Accepts `YYYY-MM-DD` and `YYYY-MM-DD HH:mm:ss` (with or without a
 * fraction) and returns a `Date`. Unknown formats and falsy values are returned
 * as `undefined`.
 * @param {unknown} value - The raw field value
 * @return {Date | undefined} The parsed date, when the value is a supported string
 * @function parseERPNextDate
 * @memberOf module:erpnext
 */
export function parseERPNextDate(value: unknown): Date | undefined {
  if (value instanceof Date) return value;
  if (typeof value !== "string" || !value.trim()) return undefined;
  const normalized = value.trim().replace(" ", "T");
  if (!/^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}:\d{2}(\.\d+)?)?/.test(normalized))
    return undefined;
  const parsed = new Date(normalized);
  if (Number.isNaN(parsed.getTime())) return undefined;
  return attachRawDateTime(parsed, value.trim());
}

function normalizeDesignType(designType: unknown): string {
  if (typeof designType === "string") return designType.toLowerCase();
  if (typeof designType === "function" && designType.name)
    return designType.name.toLowerCase();
  return "";
}

function typedAttributes(
  clazz: Constructor<Model>,
  matches: (type: string) => boolean
): Record<string, string> {
  const properties = Metadata.properties(clazz) ?? [];
  return properties.reduce(
    (accum, property) => {
      const designType =
        Metadata.type(clazz, property as keyof Model<false>) ??
        Metadata.getPropDesignTypes(
          clazz,
          property as keyof Model<false>
        )?.designType;
      if (matches(normalizeDesignType(designType)))
        accum[property] = Model.columnName(clazz, property as keyof Model<false>);
      return accum;
    },
    {} as Record<string, string>
  );
}

/**
 * @description Resolves the attributes of a model whose design type is `Date`
 * @summary Uses the decoration metadata (design type or declared type) so a string
 * coming from ERPNext can be revived into a `Date` for exactly those fields.
 * @param {Constructor<Model>} clazz - The model constructor
 * @return {Record<string, string>} Map of model attribute to column name
 * @function dateAttributes
 * @memberOf module:erpnext
 */
function dateAttributes(
  clazz: Constructor<Model>
): Record<string, string> {
  return typedAttributes(clazz, (type) => type === "date");
}

function booleanAttributes(
  clazz: Constructor<Model>
): Record<string, string> {
  return typedAttributes(clazz, (type) => type === "boolean");
}

function reviveERPNextBoolean(value: unknown): boolean | undefined {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (value === 1) return true;
    if (value === 0) return false;
    return undefined;
  }
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (normalized === "1" || normalized === "true") return true;
    if (normalized === "0" || normalized === "false") return false;
  }
  return undefined;
}

/**
 * @description Revives ERPNext date fields on a raw record
 * @summary ERPNext answers with date/datetime strings. Before the record is handed
 * to the core `revert`, the attributes whose model design type is `Date` are
 * parsed back into `Date` instances.
 * @param {Record<string, any>} record - The raw ERPNext document
 * @param {Constructor<Model>} clazz - The target model constructor
 * @return {Record<string, any>} The record with revived date fields
 * @function reviveERPNextRecord
 * @memberOf module:erpnext
 */
export function reviveERPNextRecord(
  record: Record<string, any>,
  clazz: Constructor<Model>
): Record<string, any> {
  const dates = Object.entries(dateAttributes(clazz));
  const booleans = Object.entries(booleanAttributes(clazz));
  if (!dates.length && !booleans.length) return record;
  const result = Object.assign({}, record);
  for (const [property, column] of dates) {
    const key = column in result ? column : property;
    if (!(key in result)) continue;
    const parsed = parseERPNextDate(result[key]);
    if (parsed) result[key] = parsed;
  }
  for (const [property, column] of booleans) {
    const key = column in result ? column : property;
    if (!(key in result)) continue;
    const revived = reviveERPNextBoolean(result[key]);
    if (typeof revived !== "undefined") result[key] = revived;
  }
  return result;
}
