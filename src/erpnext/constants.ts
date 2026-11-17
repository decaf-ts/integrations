/**
 * @description Identifier for the ERPNext persistence flavour
 * @summary Constant string used for adapter selection, decoration resolution and
 * `Repository.forModel` flavour lookup.
 * @const ERPNextFlavour
 * @memberOf module:erpnext
 */
export const ERPNextFlavour = "erpnext";

/**
 * @description Default ERPNext REST resource path
 * @summary Frappe serves document CRUD under `/api/resource/{doctype}`. The value
 * can be overridden through `ERPNextConfig.apiPath` for reverse-proxied setups.
 * @const ERPNextDefaultApiPath
 * @memberOf module:erpnext
 */
export const ERPNextDefaultApiPath = "/api/resource";

/**
 * @description Frappe session login endpoint
 * @summary Endpoint used for the session-login fallback when token credentials are
 * not supplied. A successful login yields a `sid` cookie used for later requests.
 * @const ERPNextLoginPath
 * @memberOf module:erpnext
 */
export const ERPNextLoginPath = "/api/method/login";

/**
 * @description Request timeout applied when the configuration does not set one
 * @summary Default timeout, in milliseconds, for every REST call.
 * @const ERPNextDefaultTimeout
 * @memberOf module:erpnext
 */
export const ERPNextDefaultTimeout = 30000;

/**
 * @description Default number of documents requested per list call
 * @summary Frappe defaults to 20 records; the adapter uses this value when a query
 * does not specify a page length.
 * @const ERPNextDefaultPageLength
 * @memberOf module:erpnext
 */
export const ERPNextDefaultPageLength = 20;

/**
 * @description Value sent to Frappe to request every matching document
 * @summary `limit_page_length=0` is Frappe's "no limit" convention. It is used
 * when the adapter must evaluate a query in memory (complex predicates and
 * aggregations) and therefore needs the full matching set.
 * @const ERPNextNoLimit
 * @memberOf module:erpnext
 */
export const ERPNextNoLimit = 0;

/**
 * @description Name of the ERPNext primary-key field
 * @summary Every Frappe doctype is identified by its `name` field.
 * @const ERPNextDocumentIdField
 * @memberOf module:erpnext
 */
export const ERPNextDocumentIdField = "name";
