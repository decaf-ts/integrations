/**
 * @module integrations/sftp/ssh2/environment
 * @summary SSH2 SFTP source environment.
 * @description Extends the common SFTP environment with the `sftp.ssh2` shape
 * matching {@link Ssh2SftpConfig}, so {@link Ssh2SftpService} can fall back to it
 * when no config is passed to `initialize`.
 */
import { SftpEnvironment } from "../core/SftpEnvironment";

export interface Ssh2SftpEnvironmentConfig {
  sourceId: string;
  host: string;
  port?: number;
  username: string;
  password?: string;
  privateKey?: string;
  passphrase?: string;
  remotePath?: string;
  readyTimeout?: number;
}

export interface Ssh2SftpEnvironmentShape {
  sftp: {
    ssh2: Ssh2SftpEnvironmentConfig;
  };
}

export const Ssh2SftpEnvironment = SftpEnvironment.accumulate({
  sftp: {
    ssh2: {
      sourceId: "",
      host: "",
      port: undefined as unknown as number,
      username: "",
      password: "",
      privateKey: "",
      passphrase: "",
      remotePath: "",
      readyTimeout: undefined as unknown as number,
    },
  },
} as Ssh2SftpEnvironmentShape);
