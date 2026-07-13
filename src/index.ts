/**
 * @module integrations
 * @summary Package entry point for shared integration helpers.
 * @description Exposes the package utilities and build-time version metadata for `@decaf-ts/integrations`.
 */
export * from "./utils";
export * from "./namespaces";
export * from "./feature-flags";

export const VERSION: string = "##VERSION##";

export const COMMIT = "##COMMIT##";

export const FULL_VERSION = "##FULL_VERSION##";

export const PACKAGE_NAME: string = "##PACKAGE##";
