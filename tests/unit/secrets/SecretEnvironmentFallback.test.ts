/**
 * @module integrations/tests/secret-environment-fallback
 * @summary Verifies the config-or-environment fallback added to secret services.
 * @description Each provider must still accept an explicit config as the first
 * `initialize()` argument (unchanged behavior), but can now also resolve its config
 * from its own `secrets.<provider>` environment slice (via real process.env
 * variables, e.g. `SECRETS__AWS__REGION`) when no config is passed, and must throw
 * when neither is available. Real env vars are used rather than `.accumulate()` for
 * the same reason documented in BlobEnvironmentFallback.test.ts.
 */
import { ValidationError } from "@decaf-ts/db-decorators";
import { AwsSecretService } from "../../../src/secrets/aws/AwsSecretService";
import { AzureKeyVaultSecretService } from "../../../src/secrets/azure/AzureKeyVaultSecretService";
import { GcpSecretManagerService } from "../../../src/secrets/gcp/GcpSecretManagerService";
import { VaultSecretService } from "../../../src/secrets/vault/VaultSecretService";
import { OnePasswordSecretService } from "../../../src/secrets/onepassword/OnePasswordSecretService";
import { ModelSecretService } from "../../../src/secrets/model/ModelSecretService";

const ENV_KEYS = [
  "SECRETS__AWS__REGION",
  "SECRETS__AZURE__VAULT_URL",
  "SECRETS__GCP__PROJECT_ID",
  "SECRETS__VAULT__ADDRESS",
  "SECRETS__VAULT__TOKEN",
  "SECRETS__VAULT__PATH",
  "SECRETS__ONE_PASSWORD__CONNECT_HOST",
  "SECRETS__MODEL__KEY_SECRET",
];

function clearEnv(): void {
  for (const key of ENV_KEYS) delete process.env[key];
}

describe("Secret environment fallback", () => {
  afterEach(() => {
    clearEnv();
  });

  describe("throws when neither config nor environment is provided", () => {
    it("AwsSecretService", async () => {
      await expect(new AwsSecretService().initialize()).rejects.toThrow(
        ValidationError
      );
    });

    it("AzureKeyVaultSecretService", async () => {
      await expect(
        new AzureKeyVaultSecretService().initialize()
      ).rejects.toThrow(ValidationError);
    });

    it("GcpSecretManagerService", async () => {
      await expect(
        new GcpSecretManagerService().initialize()
      ).rejects.toThrow(ValidationError);
    });

    it("VaultSecretService", async () => {
      await expect(new VaultSecretService().initialize()).rejects.toThrow(
        ValidationError
      );
    });

    it("OnePasswordSecretService", async () => {
      await expect(
        new OnePasswordSecretService().initialize()
      ).rejects.toThrow(ValidationError);
    });

    it("ModelSecretService", async () => {
      await expect(new ModelSecretService().initialize()).rejects.toThrow(
        ValidationError
      );
    });
  });

  describe("resolves config from environment", () => {
    it("AwsSecretService initializes without an explicit config", async () => {
      process.env.SECRETS__AWS__REGION = "us-east-1";

      const svc = new AwsSecretService();
      await svc.initialize();
      expect((svc as any).config).toEqual(
        expect.objectContaining({
          provider: "aws-secrets-manager",
          region: "us-east-1",
        })
      );
    });

    it("AzureKeyVaultSecretService initializes without an explicit config", async () => {
      process.env.SECRETS__AZURE__VAULT_URL = "https://env.vault.azure.net";

      const svc = new AzureKeyVaultSecretService();
      await svc.initialize();
      expect((svc as any).config).toEqual(
        expect.objectContaining({
          provider: "azure-key-vault",
          vaultUrl: "https://env.vault.azure.net",
        })
      );
    });

    it("GcpSecretManagerService initializes without an explicit config", async () => {
      process.env.SECRETS__GCP__PROJECT_ID = "env-project";

      const svc = new GcpSecretManagerService();
      await svc.initialize();
      expect((svc as any).config).toEqual(
        expect.objectContaining({
          provider: "gcp-secret-manager",
          projectId: "env-project",
        })
      );
    });

    it("VaultSecretService initializes without an explicit config", async () => {
      process.env.SECRETS__VAULT__ADDRESS = "https://vault.env.local";
      process.env.SECRETS__VAULT__TOKEN = "env-token";
      process.env.SECRETS__VAULT__PATH = "secret";

      const svc = new VaultSecretService();
      await svc.initialize();
      expect((svc as any).config).toEqual(
        expect.objectContaining({
          provider: "hashicorp-vault",
          address: "https://vault.env.local",
          token: "env-token",
          path: "secret",
        })
      );
    });

    it("OnePasswordSecretService initializes without an explicit config", async () => {
      process.env.SECRETS__ONE_PASSWORD__CONNECT_HOST =
        "https://connect.env.local";

      const svc = new OnePasswordSecretService();
      await svc.initialize();
      expect((svc as any).config).toEqual(
        expect.objectContaining({
          provider: "1password",
          connectHost: "https://connect.env.local",
        })
      );
    });

    it("ModelSecretService resolves config from environment", () => {
      // Full initialize() also constructs a default Repository<Secret>, which
      // needs a registered persistence adapter unrelated to config resolution
      // itself — so this checks the config-or-environment step in isolation.
      process.env.SECRETS__MODEL__KEY_SECRET = "env-key-secret";

      const svc = new ModelSecretService();
      const config = (svc as any).getConfigFromArgs();
      expect(config).toEqual(
        expect.objectContaining({
          provider: "model",
          keySecret: "env-key-secret",
        })
      );
    });
  });
});
