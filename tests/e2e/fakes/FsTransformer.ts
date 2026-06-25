/**
 * @module integrations/e2e/fakes/FsTransformer
 * @summary Request-to-context transformer for the "fs" flavour.
 * @description Mirrors {@link RamTransformer} but is registered for the `"fs"`
 * flavour. Extracts the bearer token from the `Authorization` header so the
 * initial context has a `UUID` value. The {@link KeycloakAuthHandler}'s
 * `bindToContext` later overwrites `UUID` with the JWT's email claim, which
 * is what `@createdBy` / `@updatedBy` ultimately read.
 */
import {
  RequestToContextTransformer,
} from "@decaf-ts/for-http/server";

export class FsTransformer implements RequestToContextTransformer<any> {
  async from(req: any): Promise<any> {
    const user = req.headers.authorization
      ? req.headers.authorization.split(" ")[1]
      : undefined;
    if (!user) {
      return {
        headers: req?.headers || {},
        overrides: {},
      };
    }
    return {
      UUID: user,
      headers: req?.headers || {},
      overrides: {},
    };
  }
}
