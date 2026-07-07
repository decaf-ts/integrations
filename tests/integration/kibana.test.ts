import path from "path";
import { fileURLToPath } from "url";
import axios from "axios";
import {
  KibanaService,
  KibanaSetupConfig,
  KibanaUser,
} from "../../src/kibana";
import { DockerComposeService } from "../../src/docker";

const testDirname = path.dirname(fileURLToPath(import.meta.url));
const composeFile = path.resolve(testDirname, "../../docker/kibana-compose.yml");
const workingDir = path.dirname(composeFile);

const KIBANA_HOST = "localhost:5601";
const ES_HOST = "localhost:9200";
const KIBANA_BASE_URL = `http://${KIBANA_HOST}`;
const ES_BASE_URL = `http://${ES_HOST}`;
const TEST_REALM = "test-realm";

const adminUser: KibanaUser = {
  username: "elastic",
  password: "elastic123",
};

const realmUser: KibanaUser = {
  username: "testrealmuser",
  password: "TestPassword123!",
};

const kibanaConfig: KibanaSetupConfig = {
  id: "integration-test",
  host: KIBANA_HOST,
  es_host: ES_HOST,
  protocol: "http",
  isProduction: () => false,
  realm: TEST_REALM,
  adminApiUser: adminUser,
  realmApiUser: realmUser,
};

let dockerService: DockerComposeService;
let kibanaService: KibanaService;

function esRequest() {
  return axios.create({
    baseURL: ES_BASE_URL,
    auth: { username: adminUser.username, password: adminUser.password },
    validateStatus: () => true,
  });
}

function kibanaRequest() {
  return axios.create({
    baseURL: KIBANA_BASE_URL,
    auth: { username: adminUser.username, password: adminUser.password },
    headers: { "kbn-xsrf": "true" },
    validateStatus: () => true,
  });
}

describe("Kibana Integration Tests", () => {
  beforeAll(async () => {
    dockerService = new DockerComposeService();
    await dockerService.initialize({ composeFile, workingDir });
    await dockerService.up();
    await dockerService.waitForHealth(`${KIBANA_BASE_URL}/api/status`, {
      maxAttempts: 90,
    });
    kibanaService = new KibanaService();
    await kibanaService.initialize(kibanaConfig);
  }, 180000);

  afterAll(async () => {
    await dockerService.down();
  }, 60000);

  describe("Space management", () => {
    it("should create a space", async () => {
      await kibanaService.createSpace(TEST_REALM, undefined);

      const response = await kibanaRequest().get(
        `/api/spaces/space/${TEST_REALM}`
      );
      expect(response.status).toBe(200);
      expect(response.data.id).toBe(TEST_REALM);
    });

    it("should update a space", async () => {
      await kibanaService.updateSpace(TEST_REALM, {
        description: "Updated tenant space",
      });

      const response = await kibanaRequest().get(
        `/api/spaces/space/${TEST_REALM}`
      );
      expect(response.data.description).toBe("Updated tenant space");
    });
  });

  describe("Role management", () => {
    it("should create a role", async () => {
      await kibanaService.createRole(TEST_REALM, undefined);

      const response = await esRequest().get(
        `/_security/role/pla_${TEST_REALM}_reader`
      );
      expect(response.status).toBe(200);
      expect(
        response.data[`pla_${TEST_REALM}_reader`]
      ).toBeDefined();
    });

    it("should update a role", async () => {
      await kibanaService.updateRole(TEST_REALM, {
        metadata: { updated: true },
      });

      const response = await esRequest().get(
        `/_security/role/pla_${TEST_REALM}_reader`
      );
      expect(response.data[`pla_${TEST_REALM}_reader`].metadata).toEqual({
        updated: true,
      });
    });
  });

  describe("User management", () => {
    it("should create a user", async () => {
      await kibanaService.createUser(realmUser, TEST_REALM, undefined);

      const response = await esRequest().get(
        `/_security/user/${realmUser.username}`
      );
      expect(response.status).toBe(200);
      expect(response.data[realmUser.username].enabled).toBe(true);
    });

    it("should update a user", async () => {
      await kibanaService.updateUser(
        { ...realmUser, full_name: "Test Realm User" },
        TEST_REALM,
        undefined
      );

      const response = await esRequest().get(
        `/_security/user/${realmUser.username}`
      );
      expect(response.data[realmUser.username].full_name).toBe(
        "Test Realm User"
      );
    });
  });

  describe("Data view management", () => {
    const dataViewId = `filebeat_pla_${TEST_REALM}`;

    it("should create a data view", async () => {
      await kibanaService.createDataView(TEST_REALM, {
        id: dataViewId,
        name: "PLA Filebeat Logs",
        title: `filebeat-pla-${TEST_REALM}-*`,
        timeFieldName: "@timestamp",
      });

      const response = await kibanaRequest().get(
        `/s/${TEST_REALM}/api/data_views/data_view/${dataViewId}`
      );
      expect(response.status).toBe(200);
      expect(response.data.data_view.id).toBe(dataViewId);
    });

    it("should update a data view", async () => {
      await kibanaService.updateDataView(TEST_REALM, {
        id: dataViewId,
        name: "PLA Filebeat Logs Updated",
        title: `filebeat-pla-${TEST_REALM}-*`,
        timeFieldName: "@timestamp",
      });

      const response = await kibanaRequest().get(
        `/s/${TEST_REALM}/api/data_views/data_view/${dataViewId}`
      );
      expect(response.data.data_view.name).toBe("PLA Filebeat Logs Updated");
    });
  });

  describe("Space cleanup", () => {
    it("should delete the space", async () => {
      await kibanaService.deleteSpace(TEST_REALM);

      const response = await kibanaRequest().get(
        `/api/spaces/space/${TEST_REALM}`
      );
      expect(response.status).toBe(404);
    });
  });
});
