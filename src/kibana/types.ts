export interface KibanaUser {
  username: string;
  password: string;
  full_name?: string;
  email?: string;
  enabled?: boolean;
  roles?: string[];
  metadata?: Record<string, unknown>;
}

export interface KibanaDashboardTargets {
  [key: string]: string;
}

export interface KibanaSpaceConfig {
  id: string;
  name: string;
  description?: string;
  initials?: string;
  color?: string;
  disabledFeatures?: string[];
  solution?: string;
  imageUrl?: string;
}

export interface KibanaDataViewConfig {
  id: string;
  name: string;
  title: string;
  timeFieldName?: string;
  namespaces?: string[];
  sourceFilters?: Array<{ value: string }>;
  runtimeFieldMap?: Record<string, unknown>;
  fieldAttrs?: Record<string, unknown>;
  allowNoIndex?: boolean;
}

export interface KibanaRoleConfig {
  name: string;
  indices?: Array<{
    names: string[];
    privileges: string[];
    allow_restricted_indices?: boolean;
  }>;
  applications?: Array<{
    application: string;
    privileges: string[];
    resources: string[];
  }>;
  kibana?: Array<{
    base?: string[];
    feature?: Record<string, string[]>;
    spaces?: string[];
  }>;
  metadata?: Record<string, unknown>;
}

export interface KibanaSetupConfig {
  id: string;
  host: string;
  es_host: string;
  protocol: "http" | "https";
  realm: string;
  space?: Partial<KibanaSpaceConfig>;
  dataViews?: KibanaDataViewConfig[];
  role?: Partial<KibanaRoleConfig>;
  dashboards?: KibanaDashboardTargets;
  adminApiUser?: KibanaUser;
  realmApiUser: KibanaUser;
  dashboardImportPath?: string;
  dashboardImportOverwrite?: boolean;
  assets?: string;
}
