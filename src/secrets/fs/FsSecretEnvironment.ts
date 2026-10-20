/**
 * @module integrations/secrets/fs/environment
 * @summary Environment configuration slice for the filesystem secret service.
 * @description Accumulates the `secrets.fs` slice into the shared
 * `SecretEnvironment` so `{@link FsSecretService}` can resolve its
 * `rootPath`, `keySecret`, and `keyId` from the process Environment without
 * explicit boot arguments. A missing `keySecret` disables the
 * Environment-derived configuration path.
 */

import { SecretEnvironment } from "../core/SecretEnvironment";

/**
 * @description Environment-backed configuration for the filesystem secret service
 * @summary Mirrors {@link FsSecretServiceConfig} with every field optional:
 * `rootPath` and `keyId` fall back to their defaults, while an empty
 * `keySecret` means the slice is not configured.
 */
export interface FsSecretEnvironmentConfig {
  /** @description Directory holding the secret envelopes; defaults to `.decaf/secrets`. */
  rootPath?: string;
  /** @description Master secret used to derive per-secret encryption keys. */
  keySecret?: string;
  /** @description Encryption key id recorded in envelopes; defaults to `fs-default-key`. */
  keyId?: string;
}

/**
 * @description Shape of the accumulated Environment containing the `secrets.fs` slice
 * @summary Used to type the `SecretEnvironment.accumulate` call below so the
 * `secrets.fs` accessor is fully typed.
 */
export interface FsSecretEnvironmentShape {
  secrets: {
    fs: FsSecretEnvironmentConfig;
  };
}

/**
 * @description The accumulated Environment exposing the `secrets.fs` slice
 * @summary Access it as `FsSecretEnvironment.secrets.fs.{rootPath,keySecret,keyId}`.
 */
export const FsSecretEnvironment = SecretEnvironment.accumulate({
  secrets: {
    fs: {
      rootPath: "",
      keySecret: "",
      keyId: "",
    },
  },
} as FsSecretEnvironmentShape);
