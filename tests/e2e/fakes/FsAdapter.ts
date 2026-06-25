/**
 * @module integrations/e2e/fakes/FsAdapter
 * @summary FilesystemAdapter subclass with "fs" flavour for multi-adapter e2e tests.
 * @description `FilesystemAdapter` inherits `flavour = "ram"` from `RamAdapter`'s
 * constructor. This subclass overrides the `flavour` property to `"fs"` after
 * construction so that `DecafModule.forRootAsync` generates separate controllers
 * and registers a separate transformer for the `"fs"` flavour.
 *
 * `FilesystemAdapter.decoration()` (called at import time of `@decaf-ts/core/fs`)
 * already registers `@createdBy` / `@updatedBy` handlers for the `"fs"` flavour, so
 * models annotated with `@uses("fs")` get correct createdBy/updatedBy behaviour.
 */
import { FilesystemAdapter } from "@decaf-ts/core/fs";

export class FsAdapter extends FilesystemAdapter {
  constructor(conf: any, alias?: string) {
    super(conf, alias);
    Object.defineProperty(this, "flavour", {
      value: "fs",
      writable: true,
      configurable: true,
    });
  }
}
