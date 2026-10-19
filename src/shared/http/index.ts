/**
 * @module integrations/shared/http
 * @summary Shared HTTP plumbing for client-based API services.
 * @description Re-exports {@link HttpApiService} (Axios-backed base class with
 * environment-driven config) and {@link httpError} (the failure-to-decaf-error
 * mapper used by every API service).
 */
export * from "./HttpApiService";
