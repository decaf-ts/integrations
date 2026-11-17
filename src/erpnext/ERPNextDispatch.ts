import { Dispatch } from "@decaf-ts/core";
import type { ERPNextAdapter } from "./adapter";

/**
 * @description Event dispatcher for the ERPNext adapter
 * @summary ERPNext exposes no portable pub/sub channel for document changes, so
 * the dispatcher keeps the core behaviour: it proxies the adapter CRUD methods and
 * notifies the local observers of the process that performed the change. Cross
 * process invalidation would need a Frappe webhook/event bridge, which is outside
 * this adapter core and is intentionally not simulated here.
 * @class ERPNextDispatch
 * @category ERPNext
 */
export class ERPNextDispatch extends Dispatch<ERPNextAdapter> {}
