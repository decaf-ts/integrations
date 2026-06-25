/**
 * @module integrations/e2e/fakes/FsTransformer
 * @summary Request-to-context transformer for the "fs" flavour.
 * @description Reads `user` from the auth-populated context and maps it to
 * `UUID` — the key FilesystemAdapter's `@createdBy` / `@updatedBy` handlers read.
 * Mirrors {@link RamTransformer} but is registered for the `"fs"` flavour.
 */
import {
  RequestToContextTransformer,
} from "@decaf-ts/for-http/server";

export class FsTransformer implements RequestToContextTransformer<any> {
  async from(ctx: any): Promise<any> {
    const user = ctx.getOrUndefined?.("user");
    if (!user) {
      return { overrides: {} };
    }
    return { UUID: user, overrides: {} };
  }
}
