/**
 * @module integrations/blob/ipfs/environment
 * @summary IPFS blob store environment.
 * @description Extends the common blob environment with the `blobs.ipfs` shape
 * matching {@link IpfsBlobStoreServiceConfig}, so {@link IpfsBlobStoreService}
 * can fall back to it when no config is passed to `initialize`.
 */
import { BlobEnvironment } from "../core/BlobEnvironment";

export interface IpfsKeyIndexEnvironmentConfig {
  provider: "memory" | "postgres" | "local-json";
  connectionRef?: string;
  path?: string;
}

export interface IpfsBlobEnvironmentConfig {
  sourceId: string;
  apiUrl?: string;
  gatewayUrl?: string;
  pinByDefault?: boolean;
  encryptedOnly?: boolean;
  prefix?: string;
  keyIndex: IpfsKeyIndexEnvironmentConfig;
}

export interface IpfsBlobEnvironmentShape {
  blobs: {
    ipfs: IpfsBlobEnvironmentConfig;
  };
}

export const IpfsBlobEnvironment = BlobEnvironment.accumulate({
  blobs: {
    ipfs: {
      sourceId: "",
      apiUrl: "",
      gatewayUrl: "",
      pinByDefault: undefined as unknown as boolean,
      encryptedOnly: undefined as unknown as boolean,
      prefix: "",
      keyIndex: {
        provider: "memory",
        connectionRef: "",
        path: "",
      },
    },
  },
} as IpfsBlobEnvironmentShape);
