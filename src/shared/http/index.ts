/**
 * @module integrations/shared/http
 * @summary Shared HTTP plumbing for client-based API services.
 * @description Re-exports {@link HttpApiService} (Axios-backed base class with
 * environment-driven config), {@link httpError} (the failure-to-decaf-error
 * mapper used by every API service), and {@link bootWithoutEnvironment} (the
 * Environment-hermetic boot path used by as-graph node consumers).
 */
export * from "./HttpApiService";
export * from "./hermeticBoot";
