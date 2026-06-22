import path from "path";
import {
  KeycloakService,
  KeycloakConfig,
  KeycloakUser,
  KeycloakRole,
  KeycloakGroup,
} from "../../src/keycloak";
import { DockerComposeService } from "../../src/docker";
import { describe, it, beforeAll, afterAll, expect } from "@jest/globals";

const composeFile = path.resolve(__dirname, "../../docker/keycloak-compose.yml");
const workingDir = path.dirname(composeFile);

let dockerService: DockerComposeService;
let keycloakService: KeycloakService;

const keycloakConfig: KeycloakConfig = {
  baseUrl: "http://localhost:8180",
  realm: "test-realm",
  username: "admin",
  password: "admin",
};

describe("Keycloak Integration Tests", () => {
  beforeAll(async () => {
    dockerService = new DockerComposeService();
    await dockerService.initialize({ composeFile, workingDir });
    await dockerService.up();
    await dockerService.waitForHealth(`${keycloakConfig.baseUrl}/auth/realms/master`);
    keycloakService = new KeycloakService();
    await keycloakService.initialize(keycloakConfig);
  });

  afterAll(async () => {
    await dockerService.down();
  });

  describe("KeycloakUser CRUD", () => {
    let createdUser: KeycloakUser | null = null;

    it("should create a user", async () => {
      const userPayload: KeycloakUser = {
        username: "testuser",
        email: "test@example.com",
        firstName: "Test",
        lastName: "User",
        enabled: true,
        credentials: [
          {
            type: "password",
            value: "password123",
            temporary: false,
          },
        ],
      };

      createdUser = await keycloakService.createUser(userPayload);
      expect(createdUser).not.toBeNull();
      expect(createdUser.username).toBe("testuser");
    });

    it("should read a user", async () => {
      if (!createdUser) {
        return expect.fail("User not created");
      }
      const user = await keycloakService.getUserById(createdUser.id);
      expect(user).not.toBeNull();
      expect(user.username).toBe("testuser");
      expect(user.email).toBe("test@example.com");
    });

    it("should update a user", async () => {
      if (!createdUser) {
        return expect.fail("User not created");
      }
      const updatedUser: KeycloakUser = {
        ...createdUser,
        email: "updated@example.com",
      };
      await keycloakService.updateUser(updatedUser);
      const user = await keycloakService.getUserById(createdUser.id);
      expect(user.email).toBe("updated@example.com");
    });

    it("should delete a user", async () => {
      if (!createdUser) {
        return expect.fail("User not created");
      }
      await keycloakService.deleteUser(createdUser.id);
      await expect(keycloakService.getUserById(createdUser.id)).rejects;
    });
  });

  describe("KeycloakRole CRUD", () => {
    let createdRole: KeycloakRole | null = null;

    it("should create a role", async () => {
      const rolePayload: KeycloakRole = {
        name: "test-role",
        description: "Test role",
      };

      createdRole = await keycloakService.createRole(rolePayload);
      expect(createdRole).not.toBeNull();
      expect(createdRole.name).toBe("test-role");
    });

    it("should read a role", async () => {
      if (!createdRole) {
        return expect.fail("Role not created");
      }
      const role = await keycloakService.getRoleById(createdRole.id);
      expect(role).not.toBeNull();
      expect(role.name).toBe("test-role");
    });

    it("should update a role", async () => {
      if (!createdRole) {
        return expect.fail("Role not created");
      }
      const updatedRole: KeycloakRole = {
        ...createdRole,
        description: "Updated test role",
      };
      await keycloakService.updateRole(updatedRole);
      const role = await keycloakService.getRoleById(createdRole.id);
      expect(role.description).toBe("Updated test role");
    });

    it("should delete a role", async () => {
      if (!createdRole) {
        return expect.fail("Role not created");
      }
      await keycloakService.deleteRole(createdRole.id);
      await expect(keycloakService.getRoleById(createdRole.id)).rejects;
    });
  });

  describe("KeycloakGroup CRUD", () => {
    let createdGroup: KeycloakGroup | null = null;

    it("should create a group", async () => {
      const groupPayload: KeycloakGroup = {
        name: "test-group",
        path: "/test-group",
      };

      createdGroup = await keycloakService.createGroup(groupPayload);
      expect(createdGroup).not.toBeNull();
      expect(createdGroup.name).toBe("test-group");
    });

    it("should read a group", async () => {
      if (!createdGroup) {
        return expect.fail("Group not created");
      }
      const group = await keycloakService.getGroupById(createdGroup.id);
      expect(group).not.toBeNull();
      expect(group.name).toBe("test-group");
    });

    it("should update a group", async () => {
      if (!createdGroup) {
        return expect.fail("Group not created");
      }
      const updatedGroup: KeycloakGroup = {
        ...createdGroup,
        path: "/updated-test-group",
      };
      await keycloakService.updateGroup(updatedGroup);
      const group = await keycloakService.getGroupById(createdGroup.id);
      expect(group.path).toBe("/updated-test-group");
    });

    it("should delete a group", async () => {
      if (!createdGroup) {
        return expect.fail("Group not created");
      }
      await keycloakService.deleteGroup(createdGroup.id);
      await expect(keycloakService.getGroupById(createdGroup.id)).rejects;
    });
  });
});
