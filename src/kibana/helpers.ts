import type {
  KibanaDataViewConfig,
  KibanaEnvironment,
  KibanaRoleConfig,
  KibanaSetupConfig,
  KibanaSpaceConfig,
  KibanaUser,
} from "./types";

function createDefaultKibanaSpaceConfig(realm: string): KibanaSpaceConfig {
  return {
    id: realm.toLowerCase(),
    name: realm.toUpperCase(),
    description: `Tenant space for ${realm.toUpperCase()} dashboards and logs`,
    initials: realm.slice(0, 2).toUpperCase(),
    disabledFeatures: [],
    solution: "classic",
  };
}

function createDefaultKibanaDataViewConfigs(realm: string): KibanaDataViewConfig[] {
  const suffix = realm.toLowerCase();
  return [
    {
      id: `filebeat_pla_${suffix}`,
      name: `PLA Filebeat Logs (${realm})`,
      title: `filebeat-pla-${suffix}-*`,
      timeFieldName: "@timestamp",
      allowNoIndex: true,
    },
    {
      id: `logs_pla_${suffix}`,
      name: `PLA Metricbeat Logs (${realm})`,
      title: `metricbeat-pla-${suffix}-*`,
      timeFieldName: "@timestamp",
      allowNoIndex: true,
    },
  ];
}

function createDefaultKibanaRoleConfig(realm: string): KibanaRoleConfig {
  const suffix = realm.toLowerCase();
  return {
    name: `pla_${suffix}_reader`,
    indices: [
      {
        names: [`filebeat-pla-${suffix}-*`, `metricbeat-pla-${suffix}-*`],
        privileges: ["read", "view_index_metadata"],
        allow_restricted_indices: false,
      },
    ],
    applications: [
      {
        application: "kibana-.kibana",
        privileges: ["feature_discover.read", "feature_dashboard.read"],
        resources: [`space:${realm}`],
      },
    ],
    kibana: [
      {
        spaces: [realm],
        base: ["read"],
      },
    ],
    metadata: {},
  };
}

export function createKibanaSetupConfig(
  environment: KibanaEnvironment
): KibanaSetupConfig & { assets?: string } {
  return {
    id: environment.realm,
    host: environment.host,
    es_host: environment.es_host,
    protocol: environment.protocol ?? "https",
    realm: environment.realm,
    space: createDefaultKibanaSpaceConfig(environment.realm),
    dataViews: createDefaultKibanaDataViewConfigs(environment.realm),
    role: createDefaultKibanaRoleConfig(environment.realm),
    dashboards: {},
    adminApiUser: {
      username: environment.adminApiUsername,
      password: environment.adminApiPassword,
    } satisfies KibanaUser,
    realmApiUser: {
      username: environment.realmApiUsername,
      password: environment.realmApiPassword,
    } satisfies KibanaUser,
    dashboardImportPath: environment.dashboard,
    assets: environment.assets,
  };
}
