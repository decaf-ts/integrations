import {
  createDefaultKibanaSpaceConfig,
  createDefaultKibanaDataViewConfigs,
  createDefaultKibanaRoleConfig,
} from "../../src/kibana/helpers";

describe("kibana helpers", () => {
  it("creates default space config", () => {
    const space = createDefaultKibanaSpaceConfig("demo");
    expect(space.id).toBe("demo");
    expect(space.name).toBe("DEMO");
  });

  it("creates default data view configs", () => {
    const dataViews = createDefaultKibanaDataViewConfigs("demo");
    expect(dataViews).toHaveLength(2);
    expect(dataViews[0]?.id).toBe("filebeat_pla_demo");
    expect(dataViews[1]?.id).toBe("logs_pla_demo");
  });

  it("creates default role config", () => {
    const role = createDefaultKibanaRoleConfig("demo");
    expect(role.name).toBe("pla_demo_reader");
  });
});
