import path from "path";
import {
  AwsSecretsManagerService,
  AwsSecretsManagerConfig,
  SecretPayload,
  SecretVersion,
} from "../../src/secrets/aws";
import { DockerComposeService } from "../../src/docker";
import { describe, it, beforeAll, afterAll, expect } from "@jest/globals";

const composeFile = path.resolve(__dirname, "../../docker/aws-compose.yml");
const workingDir = path.dirname(composeFile);

let dockerService: DockerComposeService;
let secretsManagerService: AwsSecretsManagerService;

const secretsManagerConfig: AwsSecretsManagerConfig = {
  region: "us-east-1",
  endpoint: "http://localhost:4566",
  accessKeyId: "test",
  secretAccessKey: "test",
};

describe("AWS Secrets Manager Integration Tests", () => {
  beforeAll(async () => {
    dockerService = new DockerComposeService();
    await dockerService.initialize({ composeFile, workingDir });
    await dockerService.up();
    await dockerService.waitForHealth(`${secretsManagerConfig.endpoint}/secretsmanager`);
    secretsManagerService = new AwsSecretsManagerService();
    await secretsManagerService.initialize(secretsManagerConfig);
  });

  afterAll(async () => {
    await dockerService.down();
  });

  describe("SecretPayload CRUD", () => {
    let createdSecret: SecretPayload | null = null;

    it("should create a secret", async () => {
      const secretName = "test-secret";
      const secretData = {
        username: "testuser",
        password: "password123",
        email: "test@example.com",
      };

      createdSecret = await secretsManagerService.createSecret(secretName, secretData);
      expect(createdSecret).to.not.be.null;
      expect(createdSecret.Name).to.equal("test-secret");
    });

    it("should read a secret", async () => {
      if (!createdSecret) {
        return expect.fail("Secret not created");
      }
      const secret = await secretsManagerService.getSecretValue(createdSecret.Name);
      expect(secret).to.not.be.null;
      const secretData = JSON.parse(secret.SecretString);
      expect(secretData.username).to.equal("testuser");
      expect(secretData.email).to.equal("test@example.com");
    });

    it("should update a secret", async () => {
      if (!createdSecret) {
        return expect.fail("Secret not created");
      }
      const updatedData = {
        username: "testuser",
        password: "newpassword456",
        email: "updated@example.com",
      };
      await secretsManagerService.putSecretValue(createdSecret.Name, updatedData);
      const secret = await secretsManagerService.getSecretValue(createdSecret.Name);
      const secretData = JSON.parse(secret.SecretString);
      expect(secretData.password).to.equal("newpassword456");
      expect(secretData.email).to.equal("updated@example.com");
    });

    it("should delete a secret", async () => {
      if (!createdSecret) {
        return expect.fail("Secret not created");
      }
      await secretsManagerService.deleteSecret(createdSecret.Name);
      await expect(secretsManagerService.getSecretValue(createdSecret.Name)).to.be.rejected;
    });
  });

  describe("SecretVersion CRUD", () => {
    let createdVersion: SecretVersion | null = null;

    it("should create a secret with multiple versions", async () => {
      const secretName = "test-version-secret";
      const version1Data = {
        key: "value1",
      };

      const secret1 = await secretsManagerService.createSecret(secretName, version1Data);
      const version1 = await secretsManagerService.getSecretValue(secretName);
      expect(version1).to.not.be.null;
      const secretData1 = JSON.parse(version1.SecretString);
      expect(secretData1.key).to.equal("value1");
    });

    it("should read a specific version", async () => {
      const secretName = "test-version-secret";
      const version2Data = {
        key: "value2",
      };
      await secretsManagerService.putSecretValue(secretName, version2Data);

      const version = await secretsManagerService.getSecretValue(secretName);
      expect(version).to.not.be.null;
      const secretData = JSON.parse(version.SecretString);
      expect(secretData.key).to.equal("value2");
    });

    it("should list secret versions", async () => {
      const secretName = "test-version-secret";
      const versions = await secretsManagerService.listSecretVersionIds(secretName);
      expect(versions).to.be.an("array");
      expect(versions.length).to.be.greaterThanOrEqual(2);
    });

    it("should delete a secret and its versions", async () => {
      const secretName = "test-version-secret";
      await secretsManagerService.deleteSecret(secretName);
      await expect(secretsManagerService.getSecretValue(secretName)).to.be.rejected;
    });
  });
});
