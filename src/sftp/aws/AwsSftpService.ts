import { service, type ContextualArgs, type MaybeContextualArg } from "@decaf-ts/core";
import { InternalError } from "@decaf-ts/db-decorators";
import {
  SftpSource,
  type SftpFileEntry,
  type SftpFileResult,
  type SftpSourceConfig,
  assertSftpConfig,
} from "../core/SftpSource";
import { AwsSftpEnvironment } from "./AwsSftpEnvironment";
import { envNumber, envString } from "../../shared/environmentValue";

export interface AwsTransferSftpConfig extends SftpSourceConfig {
  provider: "aws-transfer";
  region: string;
  bucket: string;
  s3Prefix?: string;
  serverId?: string;
}

interface S3ListObjectsV2Output {
  Contents?: Array<{ Key?: string; Size?: number; LastModified?: Date }>;
  NextContinuationToken?: string;
}

interface S3LikeClient {
  listObjectsV2(params: unknown): Promise<S3ListObjectsV2Output>;
  getObject(params: unknown): Promise<{ body: AsyncIterable<Uint8Array> }>;
  deleteObject(params: unknown): Promise<unknown>;
}

@service("sftp-aws")
export class AwsSftpService extends SftpSource<
  S3LikeClient,
  AwsTransferSftpConfig
> {
  constructor() {
    super();
  }

  protected configFromEnvironment(): AwsTransferSftpConfig | undefined {
    const env = AwsSftpEnvironment.sftp.aws;
    const region = envString(env?.region);
    const bucket = envString(env?.bucket);
    const host = envString(env?.host);
    const username = envString(env?.username);
    const password = envString(env?.password);
    const privateKey = envString(env?.privateKey);
    if (
      !region ||
      !bucket ||
      !host ||
      !username ||
      (!password && !privateKey)
    )
      return undefined;
    return {
      provider: "aws-transfer",
      sourceId: envString(env.sourceId) as string,
      host,
      port: envNumber(env.port),
      username,
      password,
      privateKey,
      passphrase: envString(env.passphrase),
      remotePath: envString(env.remotePath),
      region,
      bucket,
      s3Prefix: envString(env.s3Prefix),
      serverId: envString(env.serverId),
    };
  }

  override async initialize(
    ...args: ContextualArgs<any>
  ): Promise<{ config: AwsTransferSftpConfig; client: S3LikeClient }> {
    const config = this.getConfigFromArgs<AwsTransferSftpConfig>(...args);
    assertSftpConfig(config);
    if (!config.region)
      throw new InternalError("AwsTransferSftpConfig.region is required");
    if (!config.bucket)
      throw new InternalError("AwsTransferSftpConfig.bucket is required");

    const { S3Client } = await import("@aws-sdk/client-s3").catch(() => {
      throw new InternalError(
        "@aws-sdk/client-s3 not installed; run npm install @aws-sdk/client-s3"
      );
    });
    const client = new S3Client({
      region: config.region,
    }) as unknown as S3LikeClient;
    this._config = config;
    this._client = client;
    return { config, client };
  }

  private s3Prefix(): string {
    return this.config.s3Prefix ?? this.config.remotePath ?? "";
  }

  override async list(
    remoteDir?: string,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    ...args: MaybeContextualArg<any>
  ): Promise<SftpFileEntry[]> {
    const prefix = remoteDir ?? this.s3Prefix();
    const entries: SftpFileEntry[] = [];
    let cursor: string | undefined;
    do {
      const page = await this.client.listObjectsV2({
        Bucket: this.config.bucket,
        Prefix: prefix,
        ContinuationToken: cursor,
      });
      for (const obj of page.Contents ?? []) {
        if (!obj.Key) continue;
        const name = obj.Key.split("/").pop() ?? obj.Key;
        entries.push({
          path: obj.Key,
          name,
          size: obj.Size ?? 0,
          modifyTime: obj.LastModified?.getTime() ?? 0,
          isDirectory: obj.Key.endsWith("/"),
        });
      }
      cursor = page.NextContinuationToken;
    } while (cursor);
    return entries;
  }

  override async fetch(
    remotePath: string,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    ...args: MaybeContextualArg<any>
  ): Promise<SftpFileResult> {
    const name = remotePath.split("/").pop() ?? remotePath;
    const response = await this.client.getObject({
      Bucket: this.config.bucket,
      Key: remotePath,
    });
    const chunks: Buffer[] = [];
    for await (const chunk of response.body) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    const content = Buffer.concat(chunks);
    return { path: remotePath, name, content, size: content.length };
  }

  override async delete(
    remotePath: string,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    ...args: MaybeContextualArg<any>
  ): Promise<void> {
    await this.client.deleteObject({
      Bucket: this.config.bucket,
      Key: remotePath,
    });
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  override async close(...args: MaybeContextualArg<any>): Promise<void> {}
}
