/**
 * @module integrations/sftp/aws/environment
 * @summary AWS Transfer Family SFTP source environment.
 * @description Extends the common SFTP environment with the `sftp.aws` shape
 * matching {@link AwsTransferSftpConfig}, so {@link AwsSftpService} can fall back
 * to it when no config is passed to `initialize`.
 */
import { SftpEnvironment } from "../core/SftpEnvironment";

export interface AwsSftpEnvironmentConfig {
  sourceId: string;
  host: string;
  port?: number;
  username: string;
  password?: string;
  privateKey?: string;
  passphrase?: string;
  remotePath?: string;
  region: string;
  bucket: string;
  s3Prefix?: string;
  serverId?: string;
}

export interface AwsSftpEnvironmentShape {
  sftp: {
    aws: AwsSftpEnvironmentConfig;
  };
}

export const AwsSftpEnvironment = SftpEnvironment.accumulate({
  sftp: {
    aws: {
      sourceId: "",
      host: "",
      port: undefined as unknown as number,
      username: "",
      password: "",
      privateKey: "",
      passphrase: "",
      remotePath: "",
      region: "",
      bucket: "",
      s3Prefix: "",
      serverId: "",
    },
  },
} as AwsSftpEnvironmentShape);
