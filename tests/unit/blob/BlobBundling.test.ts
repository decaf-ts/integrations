/**
 * @module integrations/tests/bundling
 * @summary Blob bundling boundary test.
 * @description Verifies that importing the core blob entry only exposes core abstractions and does not
 * re-export provider implementations (which live behind their own subpaths).
 */
import * as blobCore from "../../../src/blob";
import { BlobStoreService, BlobStoreFactory, translateBlobError } from "../../../src/blob";

describe("Blob bundling boundaries", () => {
  it("exports core abstractions", () => {
    expect(BlobStoreService).toBeDefined();
    expect(BlobStoreFactory).toBeDefined();
    expect(translateBlobError).toBeDefined();
  });

  it("does not re-export provider implementations from the core entry", () => {
    const providerSymbols = [
      "S3BlobStoreService",
      "MinioBlobStoreService",
      "R2BlobStoreService",
      "AzureBlobStoreService",
      "GcsBlobStoreService",
      "LocalBlobStoreService",
      "IpfsBlobStoreService",
      "MemoryBlobStoreService",
    ];
    for (const symbol of providerSymbols) {
      expect((blobCore as Record<string, unknown>)[symbol]).toBeUndefined();
    }
  });
});
