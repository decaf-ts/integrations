import {
  ClientBasedService,
  Context,
  type ContextualArgs,
  type MaybeContextualArg,
} from "@decaf-ts/core";
import { InternalError, ValidationError } from "@decaf-ts/db-decorators";

export type SftpProvider = "ssh2" | "aws-transfer";

export interface SftpSourceConfig {
  provider: SftpProvider;
  sourceId: string;
  host: string;
  port?: number;
  username: string;
  password?: string;
  privateKey?: string;
  passphrase?: string;
  remotePath?: string;
}

export interface SftpFileEntry {
  path: string;
  name: string;
  size: number;
  modifyTime: number;
  isDirectory: boolean;
}

export interface SftpFileResult {
  path: string;
  name: string;
  content: Buffer;
  size: number;
}

export abstract class SftpSource<
  TClient = unknown,
  TConfig extends SftpSourceConfig = SftpSourceConfig,
> extends ClientBasedService<TClient, TConfig> {
  constructor() {
    super();
  }

  get provider(): SftpProvider {
    return this.config.provider;
  }

  get sourceId(): string {
    return this.config.sourceId;
  }

  abstract override initialize(
    ...args: ContextualArgs<any>
  ): Promise<{ config: TConfig; client: TClient }>;

  abstract list(
    remoteDir?: string,
    ...args: MaybeContextualArg<any>
  ): Promise<SftpFileEntry[]>;

  abstract fetch(
    remotePath: string,
    ...args: MaybeContextualArg<any>
  ): Promise<SftpFileResult>;

  abstract delete(
    remotePath: string,
    ...args: MaybeContextualArg<any>
  ): Promise<void>;

  abstract close(...args: MaybeContextualArg<any>): Promise<void>;

  protected getConfigFromArgs<TExpected extends TConfig>(
    ...args: MaybeContextualArg<any>
  ): TExpected {
    const config = args[0] as TExpected | undefined;
    if (config && typeof config === "object" && !(config instanceof Context)) {
      return config;
    }
    const fromEnvironment = this.configFromEnvironment() as
      | TExpected
      | undefined;
    if (fromEnvironment) return fromEnvironment;
    throw new ValidationError(
      "SFTP source config must be the first initialize argument, or resolvable from environment"
    );
  }

  /**
   * @description Builds a config from the provider's environment as a fallback.
   * @summary Providers must override this to read from their own `sftp.<provider>`
   * environment slice.
   */
  protected abstract configFromEnvironment(): TConfig | undefined;
}

export function assertSftpConfig(config: SftpSourceConfig): void {
  if (!config.host) throw new InternalError("SftpSourceConfig.host is required");
  if (!config.username) throw new InternalError("SftpSourceConfig.username is required");
  if (!config.password && !config.privateKey) {
    throw new InternalError("SftpSourceConfig requires either password or privateKey");
  }
}
