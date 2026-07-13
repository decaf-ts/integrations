/**
 * @module integrations/kibana/helpers
 * @summary Kibana configuration helpers.
 * @description Convenience builders for default Kibana spaces, data views, and role configurations.
 */
import type {
  KibanaDataViewConfig,
  KibanaRoleConfig,
  KibanaSpaceConfig,
} from "./types";
import { KibanaIndexMatchMode } from "./types";
import { KibanaIndexBuilder } from "./builders/KibanaIndexBuilder";

export function createDefaultKibanaSpaceConfig(realm: string): KibanaSpaceConfig {
  return {
    id: realm.toLowerCase(),
    name: realm.toUpperCase(),
    description: `Tenant space for ${realm.toUpperCase()} dashboards and logs`,
    initials: realm.slice(0, 2).toUpperCase(),
    disabledFeatures: [],
  };
}

export function createDefaultKibanaDataViewConfigs(realm: string): KibanaDataViewConfig[] {
  const suffix = realm.toLowerCase();
  return [
    new KibanaIndexBuilder()
      .setMatchMode(KibanaIndexMatchMode.PREFIX)
      .setPrefix(`filebeat-pla-${suffix}`)
      .setId(`filebeat_pla_${suffix}`)
      .setName(`PLA Filebeat Logs (${realm})`)
      .setTimeFieldName("@timestamp")
      .setAllowNoIndex(true)
      .build(),
    new KibanaIndexBuilder()
      .setMatchMode(KibanaIndexMatchMode.PREFIX)
      .setPrefix(`metricbeat-pla-${suffix}`)
      .setId(`logs_pla_${suffix}`)
      .setName(`PLA Metricbeat Logs (${realm})`)
      .setTimeFieldName("@timestamp")
      .setAllowNoIndex(true)
      .build(),
  ];
}

export function createDefaultKibanaRoleConfig(realm: string): KibanaRoleConfig {
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
