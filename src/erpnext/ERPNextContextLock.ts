import { ContextLock } from "@decaf-ts/core";
import type { ERPNextAdapter } from "./adapter";

/**
 * @description Transaction lock for the ERPNext adapter
 * @summary The Frappe REST resource API has no client-visible transaction
 * boundary: each document call is committed by the server when it answers. The
 * lock therefore provides only the base concurrency gating and never promises
 * atomicity across calls. It exists to satisfy the `@transactional()` contract
 * (a lock instance is always returned) while remaining explicit about the
 * limitation: callers must not rely on `commit`/`rollback` undoing remote writes.
 *
 * Doctypes whose invariants require atomic multi-document writes should be
 * implemented as a server-side Frappe method and called through
 * {@link ERPNextClient.callMethod}.
 * @class ERPNextContextLock
 * @category ERPNext
 */
export class ERPNextContextLock<
  A extends ERPNextAdapter = ERPNextAdapter,
> extends ContextLock<A> {}
