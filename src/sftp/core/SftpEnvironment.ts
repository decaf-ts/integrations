/**
 * @module integrations/sftp/core/environment
 * @summary Common SFTP environment.
 * @description Base environment shared by every SFTP source provider. Provider-specific
 * services extend this environment with their own predefined `sftp.<provider>` shape
 * so {@link SftpSource.initialize} can fall back to environment-sourced config when no
 * config is passed as the first initialize argument.
 */
import { LoggedEnvironment } from "@decaf-ts/logging";
import type { SftpProvider } from "./SftpSource";

export interface SftpCommonEnvironmentShape {
  sftp: {
    provider: SftpProvider;
  };
}

export const SftpEnvironment = LoggedEnvironment.accumulate({
  sftp: {
    provider: "" as SftpProvider,
  },
} as SftpCommonEnvironmentShape);
