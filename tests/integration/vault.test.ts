import path from "path";
import {
  VaultSecretService,
  VaultSecretServiceConfig,
} from "../../src/secrets/vault";
import { DockerComposeService } from "../../src/docker";

const composeFile = path.resolve(__dirname, "../../docker/vault-compose.yml");
const workingDir = path.dirname(composeFile);

let dockerService: DockerComposeService;
let vaultService: VaultSecretService;

const vaultConfig: VaultSecretServiceConfig = {
  provider: "hashicorp-vault",
  address: "http://localhost:8200",
  token: "my-root-token",
  path: "secret",
};

describe("Vault Integration Tests", () => {
  beforeAll(async () => {
    dockerService = new DockerComposeService();
    await dockerService.initialize({ composeFile, workingDir });
    await dockerService.up();
    await dockerService.waitForHealth(
      `${vaultConfig.address}/v1/sys/health`
    );
    vaultService = new VaultSecretService();
    await vaultService.initialize(vaultConfig);
  }, 60000);

  afterAll(async () => {
    await dockerService.down();
  }, 60000);

  describe("Secret CRUD", () => {
    const secretName = "test-secret";

    it("should store a secret", async () => {
      const reference = await vaultService.store(secretName, {
        username: "testuser",
        password: "password123",
        email: "test@example.com",
      });

      expect(reference).not.toBeNull();
      expect(reference.name).toBe(secretName);
      expect(reference.provider).toBe("hashicorp-vault");
    });

    it("should retrieve a secret", async () => {
      const secret = await vaultService.retrieve(secretName);
      expect(secret).not.toBeNull();
      const data = secret as Record<string, unknown>;
      expect(data.username).toBe("testuser");
      expect(data.email).toBe("test@example.com");
    });

    it("should check that a secret exists", async () => {
      expect(await vaultService.exists(secretName)).toBe(true);
      expect(await vaultService.exists("does-not-exist")).toBe(false);
    });

    it("should update a secret", async () => {
      await vaultService.store(secretName, {
        username: "testuser",
        password: "newpassword456",
        email: "updated@example.com",
      });

      const secret = await vaultService.retrieve(secretName);
      const data = secret as Record<string, unknown>;
      expect(data.password).toBe("newpassword456");
      expect(data.email).toBe("updated@example.com");
    });

    it("should list secrets", async () => {
      const secrets = await vaultService.list();
      expect(secrets.map((s) => s.name)).toContain(secretName);
    });

    it("should get secret metadata", async () => {
      const metadata = await vaultService.metadata(secretName);
      expect(metadata).not.toBeUndefined();
      expect(metadata!.name).toBe(secretName);
      expect(metadata!.provider).toBe("hashicorp-vault");
    });

    it("should delete a secret", async () => {
      await vaultService.delete(secretName);
      expect(await vaultService.exists(secretName)).toBe(false);
      await expect(vaultService.retrieve(secretName)).rejects.toThrow();
    });
  });
});
