/**
 * @module integrations/tests/sftp-environment-fallback
 * @summary Verifies the config-or-environment fallback added to SFTP source services.
 * @description Each provider must still accept an explicit config as the first
 * `initialize()` argument (unchanged behavior), but can now also resolve its config
 * from its own `sftp.<provider>` environment slice (via real process.env variables,
 * e.g. `SFTP__AWS__REGION`) when no config is passed, and must throw when neither is
 * available. Real env vars are used rather than `.accumulate()` for the same reason
 * documented in BlobEnvironmentFallback.test.ts.
 *
 * `Ssh2SftpService.initialize()` opens a real network connection, so only its config
 * resolution step (`configFromEnvironment()`/`getConfigFromArgs()`) is exercised here,
 * not a full `initialize()` call. `AwsSftpService.initialize()` only constructs an
 * `S3Client` (no network call), so it is exercised end to end.
 */
import { ValidationError } from "@decaf-ts/db-decorators";
import { AwsSftpService } from "../../../src/sftp/aws/AwsSftpService";
import { Ssh2SftpService } from "../../../src/sftp/ssh2/Ssh2SftpService";

const ENV_KEYS = [
  "SFTP__SSH2__HOST",
  "SFTP__SSH2__USERNAME",
  "SFTP__SSH2__PASSWORD",
  "SFTP__AWS__HOST",
  "SFTP__AWS__USERNAME",
  "SFTP__AWS__PASSWORD",
  "SFTP__AWS__REGION",
  "SFTP__AWS__BUCKET",
];

function clearEnv(): void {
  for (const key of ENV_KEYS) delete process.env[key];
}

describe("SFTP environment fallback", () => {
  afterEach(() => {
    clearEnv();
  });

  describe("throws when neither config nor environment is provided", () => {
    it("Ssh2SftpService", () => {
      expect(() => (new Ssh2SftpService() as any).getConfigFromArgs()).toThrow(
        ValidationError
      );
    });

    it("AwsSftpService", async () => {
      await expect(new AwsSftpService().initialize()).rejects.toThrow(
        ValidationError
      );
    });
  });

  describe("resolves config from environment", () => {
    it("Ssh2SftpService resolves config without an explicit config", () => {
      process.env.SFTP__SSH2__HOST = "sftp.env.local";
      process.env.SFTP__SSH2__USERNAME = "env-user";
      process.env.SFTP__SSH2__PASSWORD = "env-pass";

      const svc = new Ssh2SftpService();
      const config = (svc as any).getConfigFromArgs();
      expect(config).toEqual(
        expect.objectContaining({
          provider: "ssh2",
          host: "sftp.env.local",
          username: "env-user",
          password: "env-pass",
        })
      );
    });

    it("AwsSftpService initializes without an explicit config", async () => {
      process.env.SFTP__AWS__HOST = "sftp.env.local";
      process.env.SFTP__AWS__USERNAME = "env-user";
      process.env.SFTP__AWS__PASSWORD = "env-pass";
      process.env.SFTP__AWS__REGION = "us-east-1";
      process.env.SFTP__AWS__BUCKET = "env-bucket";

      const svc = new AwsSftpService();
      await svc.initialize();
      expect((svc as any).config).toEqual(
        expect.objectContaining({
          provider: "aws-transfer",
          host: "sftp.env.local",
          username: "env-user",
          region: "us-east-1",
          bucket: "env-bucket",
        })
      );
    });

    it("still honors an explicit config passed as the first argument", async () => {
      const svc = new AwsSftpService();
      await svc.initialize({
        provider: "aws-transfer",
        sourceId: "explicit",
        host: "explicit.local",
        username: "explicit-user",
        password: "explicit-pass",
        region: "eu-west-1",
        bucket: "explicit-bucket",
      });
      expect((svc as any).config.sourceId).toBe("explicit");
    });
  });
});
