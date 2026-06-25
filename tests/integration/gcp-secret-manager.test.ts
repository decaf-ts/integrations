import path from "path";
import {
  GcpSecretManagerService,
  GcpSecretManagerServiceConfig,
} from "../../src/secrets/gcp";
import { DockerComposeService } from "../../src/docker";

const composeFile = path.resolve(import.meta.dirname, "../../docker/gcp-compose.yml");
const workingDir = path.dirname(composeFile);

let dockerService: DockerComposeService;
let secretsManagerService: GcpSecretManagerService;

const secretsManagerConfig: GcpSecretManagerServiceConfig = {
  provider: "gcp-secret-manager",
  projectId: "test-project",
  apiEndpoint: "localhost",
  port: 9091,
};

describe("GCP Secret Manager Integration Tests", () => {
  beforeAll(async () => {
    dockerService = new DockerComposeService();
    await dockerService.initialize({ composeFile, workingDir });
    await dockerService.up();
    await dockerService.waitForHealth(
      `http://localhost:8080/v1/projects/${secretsManagerConfig.projectId}/secrets`
    );
    secretsManagerService = new GcpSecretManagerService();
    await secretsManagerService.initialize(secretsManagerConfig);
  }, 60000);

  afterAll(async () => {
    await dockerService.down();
  }, 60000);

  describe("Secret CRUD", () => {
    const secretName = "test-secret";

    it("should store a secret", async () => {
      const reference = await secretsManagerService.store(secretName, {
        username: "testuser",
        password: "password123",
        email: "test@example.com",
      });

      expect(reference).not.toBeNull();
      expect(reference.name).toBe(secretName);
      expect(reference.provider).toBe("gcp-secret-manager");
    });

    it("should retrieve a secret", async () => {
      const secret = await secretsManagerService.retrieve(secretName);
      const data = secret as Record<string, unknown>;
      expect(data.username).toBe("testuser");
      expect(data.email).toBe("test@example.com");
    });

    it("should check that a secret exists", async () => {
      expect(await secretsManagerService.exists(secretName)).toBe(true);
      expect(await secretsManagerService.exists("does-not-exist")).toBe(
        false
      );
    });

    it("should update a secret", async () => {
      await secretsManagerService.store(secretName, {
        username: "testuser",
        password: "newpassword456",
        email: "updated@example.com",
      });

      const secret = await secretsManagerService.retrieve(secretName);
      const data = secret as Record<string, unknown>;
      expect(data.password).toBe("newpassword456");
      expect(data.email).toBe("updated@example.com");
    });

    it("should list secrets", async () => {
      const secrets = await secretsManagerService.list();
      expect(secrets.map((s) => s.name)).toContain(secretName);
    });

    it("should get secret metadata", async () => {
      const metadata = await secretsManagerService.metadata(secretName);
      expect(metadata).not.toBeUndefined();
      expect(metadata!.name).toBe(secretName);
      expect(metadata!.provider).toBe("gcp-secret-manager");
    });

    it("should delete a secret", async () => {
      await secretsManagerService.delete(secretName);
      expect(await secretsManagerService.exists(secretName)).toBe(false);
      await expect(secretsManagerService.retrieve(secretName)).rejects.toThrow();
    });
  });
});
