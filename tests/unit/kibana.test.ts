import { createKibanaSetupConfig } from "../../src/kibana";

describe("kibana helpers", () => {
  it("builds kibana config from environment", () => {
    const config = createKibanaSetupConfig({
      host: "kibana.example.com",
      es_host: "elasticsearch.example.com",
      protocol: "https",
      realm: "demo",
      adminApiUsername: "admin",
      adminApiPassword: "admin-password",
      realmApiUsername: "realm",
      realmApiPassword: "realm-password",
      assets: "assets",
      dashboard: "dashboard-id",
    });

    expect(config.host).toBe("kibana.example.com");
    expect(config.adminApiUser?.username).toBe("admin");
    expect(config.assets).toBe("assets");
    expect(config.space?.id).toBe("demo");
    expect(config.dataViews?.[0]?.id).toBe("filebeat_pla_demo");
    expect(config.role?.name).toBe("pla_demo_reader");
  });
});
