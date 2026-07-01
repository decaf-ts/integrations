import path from "path";
import axios from "axios";
import {
  KeycloakService,
  KeycloakSetupConfig,
  KeycloakUser,
} from "../../src/keycloak";
import { DockerComposeService } from "../../src/docker";

const composeFile = path.resolve(
  import.meta.dirname,
  "../../docker/keycloak-compose.yml"
);
const workingDir = path.dirname(composeFile);

// Use KEYCLOAK_HOST env var if provided (external Keycloak), otherwise
// fall back to localhost:8180 and start a fresh container via docker-compose.
const EXTERNAL_KEYCLOAK_HOST = process.env.KEYCLOAK_HOST;
const KEYCLOAK_HOST = EXTERNAL_KEYCLOAK_HOST || "localhost:8180";
const KEYCLOAK_BASE_URL = `http://${KEYCLOAK_HOST}`;
const TEST_REALM = "integration-test-realm";

const adminUser: KeycloakUser = {
  realm: "master",
  apiClientId: "admin-cli",
  username: "admin",
  password: "admin",
};

const keycloakConfig: KeycloakSetupConfig = {
  id: "integration-test",
  host: KEYCLOAK_HOST,
  protocol: "http",
  isProduction: () => false,
  rootApiUser: adminUser,
  adminApiUser: adminUser,
  realmApiUser: adminUser,
  client: {
    clientId: "integration-test-client",
    secret: "integration-test-secret",
    clientName: "Integration Test Client",
    redirectUris: ["http://localhost/*"],
    webOrigins: ["http://localhost"],
  },
};

let dockerService: DockerComposeService | undefined;
let keycloakService: KeycloakService;

async function waitForAdminToken(): Promise<void> {
  const tokenUrl = `${KEYCLOAK_BASE_URL}/realms/master/protocol/openid-connect/token`;
  const body = new URLSearchParams({
    client_id: adminUser.apiClientId,
    username: adminUser.username,
    password: adminUser.password,
    grant_type: "password",
  }).toString();

  let lastError: unknown;
  for (let attempt = 0; attempt < 30; attempt += 1) {
    try {
      const response = await fetch(tokenUrl, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body,
      });
      const data = await response.json().catch(() => undefined);
      if (response.ok && data?.access_token) return;
      lastError = new Error(
        `Keycloak token not ready (${response.status}): ${JSON.stringify(data)}`
      );
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }

  throw lastError instanceof Error
    ? lastError
    : new Error("Keycloak token endpoint did not become ready");
}

// Independent verification helpers: hit the Keycloak Admin REST API directly
// with axios so assertions don't rely on the same code path being tested.
async function getAdminAccessToken(): Promise<string> {
  const response = await axios.post(
    `${KEYCLOAK_BASE_URL}/realms/master/protocol/openid-connect/token`,
    new URLSearchParams({
      client_id: adminUser.apiClientId,
      username: adminUser.username,
      password: adminUser.password,
      grant_type: "password",
    }).toString(),
    { headers: { "Content-Type": "application/x-www-form-urlencoded" } }
  );
  return response.data.access_token;
}

function adminRequest(token: string) {
  return axios.create({
    baseURL: KEYCLOAK_BASE_URL,
    headers: { Authorization: `Bearer ${token}` },
    validateStatus: () => true,
  });
}

async function fetchUserByUsername(
  realmName: string,
  username: string,
  token: string
) {
  const response = await adminRequest(token).get(
    `/admin/realms/${realmName}/users`,
    { params: { username } }
  );
  return response.data[0];
}

describe("Keycloak Integration Tests", () => {
  beforeAll(async () => {
    if (!EXTERNAL_KEYCLOAK_HOST) {
      dockerService = new DockerComposeService();
      await dockerService.initialize({ composeFile, workingDir });
      await dockerService.up();
      await dockerService.waitForHealth(`${KEYCLOAK_BASE_URL}/realms/master`);
      await waitForAdminToken();
    }
    keycloakService = new KeycloakService();
    await keycloakService.initialize(keycloakConfig);

    // Clean up any leftover realm from a previous run
    try {
      await keycloakService.removeRealm(TEST_REALM);
    } catch {
      // realm may not exist
    }
  }, 60000);

  afterAll(async () => {
    if (dockerService) {
      await dockerService.down();
    }
  }, 60000);

  describe("Realm management", () => {
    it("should create a realm", async () => {
      await keycloakService.addRealm(TEST_REALM, {
        displayName: "Integration Test Realm",
      });

      const token = await getAdminAccessToken();
      const response = await adminRequest(token).get(
        `/admin/realms/${TEST_REALM}`
      );
      expect(response.status).toBe(200);
      expect(response.data.realm).toBe(TEST_REALM);
      expect(response.data.displayName).toBe("Integration Test Realm");
    });

    it("should edit the realm", async () => {
      await keycloakService.editRealm(TEST_REALM, {
        displayName: "Updated Integration Test Realm",
      });

      const token = await getAdminAccessToken();
      const response = await adminRequest(token).get(
        `/admin/realms/${TEST_REALM}`
      );
      expect(response.data.displayName).toBe("Updated Integration Test Realm");
    });
  });

  describe("User management", () => {
    let createdUserId: string;

    it("should add a user to the realm", async () => {
      const newUser: KeycloakUser = {
        realm: TEST_REALM,
        apiClientId: "admin-cli",
        username: "testuser",
        password: "password123",
      };

      await keycloakService.addUserToRealm(newUser, {
        firstName: "Test",
        lastName: "User",
        email: "test@example.com",
        emailVerified: true,
        enabled: true,
      });

      const token = await getAdminAccessToken();
      const user = await fetchUserByUsername(TEST_REALM, "testuser", token);
      expect(user).toBeDefined();
      expect(user.username).toBe("testuser");
      expect(user.email).toBe("test@example.com");
      createdUserId = user.id;
    });

    it("should edit the user", async () => {
      await keycloakService.editUser(TEST_REALM, createdUserId, {
        email: "updated@example.com",
      });

      const token = await getAdminAccessToken();
      const user = await fetchUserByUsername(TEST_REALM, "testuser", token);
      expect(user.email).toBe("updated@example.com");
    });

    it("should grant a realm role to the user", async () => {
      await keycloakService.addRealmRolesToUser(TEST_REALM, createdUserId, [
        "offline_access",
      ]);

      const token = await getAdminAccessToken();
      const response = await adminRequest(token).get(
        `/admin/realms/${TEST_REALM}/users/${createdUserId}/role-mappings/realm`
      );
      const roleNames = (response.data as Array<{ name: string }>).map(
        (role) => role.name
      );
      expect(roleNames).toContain("offline_access");
    });

    it("should remove the user from the realm", async () => {
      await keycloakService.removeUserFromRealm(TEST_REALM, createdUserId);

      const token = await getAdminAccessToken();
      const response = await adminRequest(token).get(
        `/admin/realms/${TEST_REALM}/users/${createdUserId}`
      );
      expect(response.status).toBe(404);
    });
  });

  describe("Realm cleanup", () => {
    it("should remove the realm", async () => {
      await keycloakService.removeRealm(TEST_REALM);

      const token = await getAdminAccessToken();
      const response = await adminRequest(token).get(
        `/admin/realms/${TEST_REALM}`
      );
      expect(response.status).toBe(404);
    });
  });
});
