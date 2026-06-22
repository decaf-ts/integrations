import path from "path";
import {
  KibanaService,
  KibanaConfig,
  KibanaUser,
  KibanaRole,
  KibanaSpace,
} from "../../src/kibana";
import { DockerComposeService } from "../../src/docker";
import { describe, it, beforeAll, afterAll, expect } from "@jest/globals";

const composeFile = path.resolve(__dirname, "../../docker/kibana-compose.yml");
const workingDir = path.dirname(composeFile);

let dockerService: DockerComposeService;
let kibanaService: KibanaService;

const kibanaConfig: KibanaConfig = {
  baseUrl: "http://localhost:5601",
  username: "admin",
  password: "admin",
};

describe("Kibana Integration Tests", () => {
  beforeAll(async () => {
    dockerService = new DockerComposeService();
    await dockerService.initialize({ composeFile, workingDir });
    await dockerService.up();
    await dockerService.waitForHealth(`${kibanaConfig.baseUrl}/api/status`);
    kibanaService = new KibanaService();
    await kibanaService.initialize(kibanaConfig);
  });

  afterAll(async () => {
    await dockerService.down();
  });

  describe("KibanaUser CRUD", () => {
    let createdUser: KibanaUser | null = null;

    it("should create a user", async () => {
      const userPayload: KibanaUser = {
        username: "testuser",
        password: "password123",
        email: "test@example.com",
        enabled: true,
      };

      const realmName = kibanaConfig.realm || "test-realm";
      await kibanaService.createUser(userPayload, realmName);
      const user = await kibanaService.getUserByUsername(userPayload.username);
      expect(user).not.toBeNull();
      expect(user.username).toBe("testuser");
      createdUser = user;
    });

    it("should read a user", async () => {
      if (!createdUser) {
        return expect.fail("User not created");
      }
      const user = await kibanaService.getUserByUsername(createdUser.username);
      expect(user).not.toBeNull();
      expect(user.username).toBe("testuser");
      expect(user.email).toBe("test@example.com");
    });

    it("should update a user", async () => {
      if (!createdUser) {
        return expect.fail("User not created");
      }
      const updatedUser: KibanaUser = {
        ...createdUser,
        email: "updated@example.com",
      };
      await kibanaService.updateUser(updatedUser, kibanaConfig.realm || "test-realm");
      const user = await kibanaService.getUserByUsername(createdUser.username);
      expect(user.email).toBe("updated@example.com");
    });

    it("should delete a user", async () => {
      if (!createdUser) {
        return expect.fail("User not created");
      }
      await kibanaService.deleteUser(createdUser.username);
      await expect(kibanaService.getUserByUsername(createdUser.username)).rejects;
    });
  });

  describe("KibanaRole CRUD", () => {
    let createdRole: KibanaRole | null = null;

    it("should create a role", async () => {
      const rolePayload: KibanaRole = {
        name: "test-role",
        cluster_permissions: ["cluster_composite_ops"],
        index_permissions: [
          {
            index_patterns: ["*"],
            permissions: ["indices_all"],
          },
        ],
        tenant_permissions: [
          {
            tenant_patterns: ["global"],
            permissions: ["read"],
          },
        ],
      };

      const realmName = kibanaConfig.realm || "test-realm";
      await kibanaService.createRole(rolePayload, realmName);
      const role = await kibanaService.getRoleByName(rolePayload.name);
      expect(role).not.toBeNull();
      expect(role.name).toBe("test-role");
      createdRole = role;
    });

    it("should read a role", async () => {
      if (!createdRole) {
        return expect.fail("Role not created");
      }
      const role = await kibanaService.getRoleByName(createdRole.name);
      expect(role).not.toBeNull();
      expect(role.name).toBe("test-role");
    });

    it("should update a role", async () => {
      if (!createdRole) {
        return expect.fail("Role not created");
      }
      const updatedRole: KibanaRole = {
        ...createdRole,
        description: "Updated test role",
      };
      await kibanaService.updateRole(updatedRole, kibanaConfig.realm || "test-realm");
      const role = await kibanaService.getRoleByName(createdRole.name);
      expect(role.description).toBe("Updated test role");
    });

    it("should delete a role", async () => {
      if (!createdRole) {
        return expect.fail("Role not created");
      }
      await kibanaService.deleteRole(createdRole.name);
      await expect(kibanaService.getRoleByName(createdRole.name)).rejects;
    });
  });

  describe("KibanaSpace CRUD", () => {
    let createdSpace: KibanaSpace | null = null;

    it("should create a space", async () => {
      const spacePayload: KibanaSpace = {
        id: "test-space",
        name: "Test Space",
        description: "Test space description",
      };

      const realmName = kibanaConfig.realm || "test-realm";
      await kibanaService.createSpace(spacePayload, realmName);
      const space = await kibanaService.getSpaceById(spacePayload.id);
      expect(space).not.toBeNull();
      expect(space.id).toBe("test-space");
      createdSpace = space;
    });

    it("should read a space", async () => {
      if (!createdSpace) {
        return expect.fail("Space not created");
      }
      const space = await kibanaService.getSpaceById(createdSpace.id);
      expect(space).not.toBeNull();
      expect(space.id).toBe("test-space");
      expect(space.name).toBe("Test Space");
    });

    it("should update a space", async () => {
      if (!createdSpace) {
        return expect.fail("Space not created");
      }
      const updatedSpace: KibanaSpace = {
        ...createdSpace,
        description: "Updated test space description",
      };
      await kibanaService.updateSpace(updatedSpace, kibanaConfig.realm || "test-realm");
      const space = await kibanaService.getSpaceById(createdSpace.id);
      expect(space.description).toBe("Updated test space description");
    });

    it("should delete a space", async () => {
      if (!createdSpace) {
        return expect.fail("Space not created");
      }
      await kibanaService.deleteSpace(createdSpace.id);
      await expect(kibanaService.getSpaceById(createdSpace.id)).rejects;
    });
  });
});
