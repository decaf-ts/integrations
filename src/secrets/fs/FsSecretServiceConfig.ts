/**
 * @module integrations/secrets/fs/config
 * @summary Configuration contract for the filesystem secret service.
 * @description Defines {@link FsSecretServiceConfig} — the boot configuration
 * accepted by `{@link FsSecretService}` and its node counterpart — plus the
 * `DEFAULT_FS_SECRET_ROOT` and `DEFAULT_FS_SECRET_KEY_ID` fallbacks applied
 * when the `secrets.fs` Environment slice or explicit arguments omit them.
 */

import type { SecretServiceConfig } from "../core";

/**
 * @description Default root directory for the filesystem secret store
 * @summary Relative paths are resolved against the process working directory
 * during `FsSecretService.initialize`.
 */
export const DEFAULT_FS_SECRET_ROOT = ".decaf/secrets";

/**
 * @description Default encryption key id for filesystem secret envelopes
 * @summary Recorded in each envelope's `encryption.keyId` when the
 * configuration does not name a key explicitly.
 */
export const DEFAULT_FS_SECRET_KEY_ID = "fs-default-key";

/**
 * @description Boot configuration for the filesystem secret service
 * @summary The `keySecret` is mandatory — it is the master secret from which
 * per-secret encryption keys are derived; `rootPath` and `keyId` fall back to
 * {@link DEFAULT_FS_SECRET_ROOT} and {@link DEFAULT_FS_SECRET_KEY_ID}.
 */
export interface FsSecretServiceConfig extends SecretServiceConfig {
  /** @description Fixed provider discriminator for the filesystem backend. */
  provider: "filesystem";
  /** @description Directory holding the `<name>.json` secret envelopes (created with mode `0o700`). */
  rootPath: string;
  /** @description Master secret used to derive per-secret encryption keys. */
  keySecret: string;
  /** @description Optional encryption key id recorded in envelopes; defaults to `fs-default-key`. */
  keyId?: string;
}
