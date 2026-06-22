import path from "path";
import {
  VaultService,
  VaultConfig,
  VaultSecret,
  VaultSecretVersion,
  VaultPolicy,
} from "../../src/secrets/vault";
import { DockerComposeService } from "../../src/docker";
import { describe, it, beforeAll, afterAll, expect } from "@jest/globals";

const composeFile = path.resolve(__dirname, "../../docker/vault-compose.yml");
const workingDir = path.dirname(composeFile);

let dockerService: DockerComposeService;
let vaultService: VaultService;

const vaultConfig: VaultConfig = {
  baseUrl: "http://localhost:8200",
  token: "test-token",
  namespace: "root",
};

describe("Vault Integration Tests", () => {
  beforeAll(async () => {
    dockerService = new DockerComposeService();
    await dockerService.initialize({ composeFile, workingDir });
    await dockerService.up();
    await dockerService.waitForHealth(`${vaultConfig.baseUrl}/v1/sys/health`);
    vaultService = new VaultService();
    await vaultService.initialize(vaultConfig);
  });

  afterAll(async () => {
    await dockerService.down();
  });

  describe("VaultSecret CRUD", () => {
    let createdSecret: VaultSecret | null = null;

    it("should create a secret", async () => {
      const secretPath = "secret/test-secret";
      const secretData = {
        username: "testuser",
        password: "password123",
        email: "test@example.com",
      };

      createdSecret = await vaultService.createSecret(secretPath, secretData);
      expect(createdSecret).to.not.be.null;
      expect(createdSecret.data.username).to.equal("testuser");
    });

    it("should read a secret", async () => {
      if (!createdSecret) {
        return expect.fail("Secret not created");
      }
      const secretPath = "secret/test-secret";
      const secret = await vaultService.readSecret(secretPath);
      expect(secret).to.not.be.null;
      expect(secret.data.username).to.equal("testuser");
      expect(secret.data.email).to.equal("test@example.com");
    });

    it("should update a secret", async () => {
      if (!createdSecret) {
        return expect.fail("Secret not created");
      }
      const secretPath = "secret/test-secret";
      const updatedData = {
        username: "testuser",
        password: "newpassword456",
        email: "updated@example.com",
      };
      await vaultService.updateSecret(secretPath, updatedData);
      const secret = await vaultService.readSecret(secretPath);
      expect(secret.data.password).to.equal("newpassword456");
      expect(secret.data.email).to.equal("updated@example.com");
    });

    it("should delete a secret", async () => {
      if (!createdSecret) {
        return expect.fail("Secret not created");
      }
      const secretPath = "secret/test-secret";
      await vaultService.deleteSecret(secretPath);
      await expect(vaultService.readSecret(secretPath)).to.be.rejected;
    });
  });

  describe("VaultSecretVersion CRUD", () => {
    let createdVersion: VaultSecretVersion | null = null;

    it("should create a secret with multiple versions", async () => {
      const secretPath = "secret/version-test";
      const version1Data = {
        key: "value1",
      };

      await vaultService.createSecret(secretPath, version1Data);
      const version1 = await vaultService.readSecretVersion(secretPath, 1);
      expect(version1).to.not.be.null;
      expect(version1.data.key).to.equal("value1");
    });

    it("should read a specific version", async () => {
      const secretPath = "secret/version-test";
      const version2Data = {
        key: "value2",
      };
      await vaultService.updateSecret(secretPath, version2Data);

      const version2 = await vaultService.readSecretVersion(secretPath, 2);
      expect(version2.data.key).to.equal("value2");

      const version1 = await vaultService.readSecretVersion(secretPath, 1);
      expect(version1.data.key).to.equal("value1");
    });

    it("should list versions", async () => {
      const secretPath = "secret/version-test";
      const versions = await vaultService.listSecretVersions(secretPath);
      expect(versions.data.keys).to.be.an("array");
      expect(versions.data.keys).to.contain("1");
      expect(versions.data.keys).to.contain("2");
    });

    it("should delete a secret and its versions", async () => {
      const secretPath = "secret/version-test";
      await vaultService.deleteSecret(secretPath);
      await expect(vaultService.readSecret(secretPath)).to.be.rejected;
    });
  });

  describe("VaultPolicy CRUD", () => {
    let createdPolicy: VaultPolicy | null = null;

    it("should create a policy", async () => {
      const policyName = "test-policy";
      const policyBody = `
        path "secret/data/test-secret" {
          capabilities = ["read", "create", "update"]
        }
      `;

      createdPolicy = await vaultService.createPolicy(policyName, policyBody);
      expect(createdPolicy).to.not.be.null;
      expect(createdPolicy.name).to.equal("test-policy");
    });

    it("should read a policy", async () => {
      if (!createdPolicy) {
        return expect.fail("Policy not created");
      }
      const policy = await vaultService.readPolicy(createdPolicy.name);
      expect(policy).to.not.be.null;
      expect(policy.name).to.equal("test-policy");
    });

    it("should update a policy", async () => {
      if (!createdPolicy) {
        return expect.fail("Policy not created");
      }
      const updatedPolicyBody = `
        path "secret/data/test-secret" {
          capabilities = ["read", "create", "update", "delete"]
        }
      `;
      await vaultService.updatePolicy(createdPolicy.name, updatedPolicyBody);
      const policy = await vaultService.readPolicy(createdPolicy.name);
      expect(policy).to.not.be.null;
    });

    it("should delete a policy", async () => {
      if (!createdPolicy) {
        return expect.fail("Policy not created");
      }
      await vaultService.deletePolicy(createdPolicy.name);
      await expect(vaultService.readPolicy(createdPolicy.name)).to.be.rejected;
    });
  });
});
