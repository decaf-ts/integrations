/**
 * @module integrations/blob/core/types
 * @summary Blob core types.
 * @description Shared payload, metadata, option, and configuration types for blob store service implementations.
 */
export type BlobProvider =
  | "s3"
  | "minio"
  | "r2"
  | "azure-blob"
  | "gcs"
  | "local"
  | "ipfs"
  | "memory";

export type BlobKey = string;

export type BlobValue =
  | Uint8Array
  | Buffer
  | AsyncIterable<Uint8Array>
  | ReadableStream;

export interface BlobMetadata {
  contentType?: string;
  contentLength?: number;
  sha256?: string;
  etag?: string;
  versionId?: string;
  cid?: string;
  custom?: Record<string, string>;
}

export interface BlobPutOptions {
  contentType?: string;
  metadata?: Record<string, string>;
  ifNotExists?: boolean;
  expectedSha256?: string;
}

export interface BlobGetOptions {
  range?: { start: number; end?: number };
  versionId?: string;
}

export interface BlobListOptions {
  prefix?: string;
  limit?: number;
  cursor?: string;
}

export interface BlobEntry {
  key: BlobKey;
  metadata?: BlobMetadata;
}

export interface BlobListResult {
  items: BlobEntry[];
  cursor?: string;
}

export interface BlobPutResult {
  key: BlobKey;
  uri: string;
  provider: BlobProvider;
  sourceId: string;
  metadata: BlobMetadata;
}

export interface BlobGetResult {
  key: BlobKey;
  value: AsyncIterable<Uint8Array>;
  uri: string;
  provider: BlobProvider;
  sourceId: string;
  metadata: BlobMetadata;
}

export interface BlobUrlOptions {
  operation?: "get" | "put";
  expiresInSeconds?: number;
  contentType?: string;
  metadata?: Record<string, string>;
}

export interface BlobUrlResult {
  url: string;
  method: "GET" | "PUT";
  expiresAt: Date;
  headers?: Record<string, string>;
}

export interface BlobStoreServiceConfig {
  provider: BlobProvider;
  sourceId: string;
  prefix?: string;
  credentialsRef?: string;
  endpoint?: string;
  region?: string;
  timeoutMs?: number;
  maxRetries?: number;
  [key: string]: unknown;
}

export interface S3BlobStoreServiceConfig extends BlobStoreServiceConfig {
  provider: "s3" | "minio" | "r2";
  bucket: string;
  forcePathStyle?: boolean;
  autoCreateBucket?: boolean;
  credentials?: {
    accessKeyId: string;
    secretAccessKey: string;
    sessionToken?: string;
  };
}

export interface AzureBlobStoreServiceConfig extends BlobStoreServiceConfig {
  provider: "azure-blob";
  container: string;
  accountName?: string;
  connectionString?: string;
}

export interface GcsBlobStoreServiceConfig extends BlobStoreServiceConfig {
  provider: "gcs";
  bucket: string;
  projectId?: string;
  credentials?: Record<string, unknown>;
  apiEndpoint?: string;
}

export interface LocalBlobStoreServiceConfig extends BlobStoreServiceConfig {
  provider: "local";
  rootPath: string;
}

export interface IpfsKeyIndexConfig {
  provider: "memory" | "postgres" | "local-json";
  connectionRef?: string;
  path?: string;
}

export interface IpfsBlobStoreServiceConfig extends BlobStoreServiceConfig {
  provider: "ipfs";
  apiUrl?: string;
  gatewayUrl?: string;
  pinByDefault?: boolean;
  encryptedOnly?: boolean;
  keyIndex: IpfsKeyIndexConfig;
}
