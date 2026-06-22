import path from "path";
import {
  GcpSecretManagerService,
  GcpSecretManagerConfig,
  SecretPayload,
  SecretVersion,
} from "../../src/secrets/gcp";
import { DockerComposeService } from "../../src/docker";
import { describe, it, beforeAll, afterAll, expect } from "@jest/globals";

const composeFile = path.resolve(__dirname, "../../docker/gcp-compose.yml");
const workingDir = path.dirname(composeFile);

let dockerService: DockerComposeService;
let secretsManagerService: GcpSecretManagerService;

const secretsManagerConfig: GcpSecretManagerConfig = {
  projectId: "test-project",
  endpoint: "http://localhost:8089",
};

describe("GCP Secret Manager Integration Tests", () => {
  beforeAll(async () => {
    dockerService = new DockerComposeService();
    await dockerService.initialize({ composeFile, workingDir });
    await dockerService.up();
    await dockerService.waitForHealth(`${secretsManagerConfig.endpoint}/v1/projects`);
    secretsManagerService = new GcpSecretManagerService();
    await secretsManagerService.initialize(secretsManagerConfig);
  });

  afterAll(async () => {
    await dockerService.down();
  });

  describe("SecretPayload CRUD", () => {
    let createdSecret: SecretPayload | null = null;

    it("should create a secret", async () => {
      const secretId = "test-secret";
      const secretData = {
        username: "testuser",
        password: "password123",
        email: "test@example.com",
      };

      createdSecret = await secretsManagerService.addSecret(secretId, secretData);
      expect(createdSecret).to.not.be.null;
      expect(createdSecret.name).to.include("test-secret");
    });

    it("should read a secret", async () => {
      if (!createdSecret) {
        return expect.fail("Secret not created");
      }
      const secret = await secretsManagerService.accessSecret(createdSecret.name);
      expect(secret).to.not.be.null;
      const secretData = JSON.parse(secret.payload.data);
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
      await secretsManagerService.addSecretVersion(createdSecret.name, updatedData);
      const secret = await secretsManagerService.accessSecret(createdSecret.name);
      const secretData = JSON.parse(secret.payload.data);
      expect(secretData.password).to.equal("newpassword456");
      expect(secretData.email).to.equal("updated@example.com");
    });

    it("should delete a secret", async () => {
      if (!createdSecret) {
        return expect.fail("Secret not created");
      }
      await secretsManagerService.deleteSecret(createdSecret.name);
      await expect(secretsManagerService.accessSecret(createdSecret.name)).to.be.rejected;
    });
  });

  describe("SecretVersion CRUD", () => {
    let createdVersion: SecretVersion | null = null;

    it("should create a secret with multiple versions", async () => {
      const secretId = "test-version-secret";
      const version1Data = {
        key: "value1",
      };

      const secret1 = await secretsManagerService.addSecret(secretId, version1Data);
      const version1 = await secretsManagerService.accessSecret(secret1.name);
      expect(version1).to.not.be.null;
      const secretData1 = JSON.parse(version1.payload.data);
      expect(secretData1.key).to.equal("value1");
    });

    it("should read a specific version", async () => {
      const secretId = "test-version-secret";
      const version2Data = {
        key: "value2",
      };
      await secretsManagerService.addSecretVersion(secretId, version2Data);

      const secret = await secretsManagerService.accessSecret(secretId);
      expect(secret).to.not.be.null;
      const secretData = JSON.parse(secret.payload.data);
      expect(secretData.key).to.equal("value2");
    });

    it("should list secret versions", async () => {
      const secretId = "test-version-secret";
      const versions = await secretsManagerService.listSecretVersions(secretId);
      expect(versions).to.be.an("array");
      expect(versions.length).to.be.greaterThanOrEqual(2);
    });

    it("should delete a secret and its versions", async () => {
      const secretId = "test-version-secret";
      await secretsManagerService.deleteSecret(secretId);
      await expect(secretsManagerService.accessSecret(secretId)).to.be.rejected;
    });
  });
});
