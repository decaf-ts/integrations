export enum IsolationTier {
  Pooled = "pooled",
  Bridge = "bridge",
  Silo = "silo",
}

export enum MembershipStatus {
  Invited = "invited",
  Active = "active",
  Suspended = "suspended",
  Removed = "removed",
}

export enum PrincipalKind {
  User = "user",
  Group = "group",
  ServiceAccount = "service_account",
  Agent = "agent",
  ApiKey = "api_key",
}

export enum ScopeKind {
  Tenant = "tenant",
  OrgUnit = "org_unit",
  Resource = "resource",
}

export enum PermissionCategory {
  Admin = "admin",
  ContentRead = "content_read",
  ContentWrite = "content_write",
  Memory = "memory",
  Graph = "graph",
  Vector = "vector",
  Export = "export",
  Billing = "billing",
  Audit = "audit",
  Security = "security",
  Data = "data",
  Automation = "automation",
}

export enum ResourceVisibility {
  Private = "private",
  ResourceAcl = "resource_acl",
  OrgUnit = "org_unit",
  OrgSubtree = "org_subtree",
  Tenant = "tenant",
}

export enum StorageKind {
  Postgres = "postgres",
  Arango = "arango",
  Qdrant = "qdrant",
  ObjectStorage = "object_storage",
}

export enum StorageBindingKind {
  Shared = "shared",
  Dedicated = "dedicated",
}

export const IsolationTierOptions = Object.values(IsolationTier);
export const MembershipStatusOptions = Object.values(MembershipStatus);
export const PrincipalKindOptions = Object.values(PrincipalKind);
export const ScopeKindOptions = Object.values(ScopeKind);
export const PermissionCategoryOptions = Object.values(PermissionCategory);
export const ResourceVisibilityOptions = Object.values(ResourceVisibility);
export const StorageKindOptions = Object.values(StorageKind);
export const StorageBindingKindOptions = Object.values(StorageBindingKind);

export type TxArgs = any[];

export interface CreateTenantInput {
  slug: string;
  name: string;
  isolationTier?: IsolationTier;
  profileKey?: string;
  profileMetadata?: Record<string, unknown>;
}

export interface CreateUserInput {
  email?: string;
  phone?: string;
  displayName: string;
}

export interface CreateOrgUnitInput {
  tenantId: string;
  parentOrgUnitId?: string;
  name: string;
  metadata?: Record<string, unknown>;
  profileKey?: string;
  profileMetadata?: Record<string, unknown>;
}

export interface CreateRoleInput {
  tenantId?: string;
  key: string;
  name: string;
  description?: string;
  metadata?: Record<string, unknown>;
}

export interface CreatePermissionInput {
  key: string;
  category: PermissionCategory;
  description?: string;
}

export interface AssignRoleInput {
  tenantId: string;
  principalId: string;
  roleId: string;
  scopeKind: ScopeKind;
  scopeId: string;
  inheritDown?: boolean;
  startsAt?: Date;
  expiresAt?: Date;
  conditions?: Record<string, unknown>;
}

export interface RegisterResourceInput {
  tenantId: string;
  orgUnitId: string;
  resourceType: string;
  resourceId: string;
  visibility: ResourceVisibility;
  ownerPrincipalId?: string;
  sensitivity?: string;
  metadata?: Record<string, unknown>;
}

export interface GrantResourceInput {
  tenantId: string;
  resourceId: string;
  principalId: string;
  permissionKey: string;
  startsAt?: Date;
  expiresAt?: Date;
  conditions?: Record<string, unknown>;
  createdByPrincipalId?: string;
}

export interface CanAccessInput {
  tenantId: string;
  principalId: string;
  permissionKey: string;
  resourceProtectedId?: string;
  scopeKind?: ScopeKind;
  scopeId?: string;
  at?: Date;
}

export interface AccessContext {
  tenantId: string;
  principalId: string;
  permissionsByScope: Record<string, string[]>;
  allowedOrgUnitIdsByPermission: Record<string, string[]>;
  resourceGrants: Array<{ resourceId: string; permissionKey: string }>;
}

export interface ArangoAuthContext {
  tenantId: string;
  principalId: string;
  permissionKey: string;
  allowedOrgUnitIds: string[];
  allowedResourceIds: string[];
}

export interface QdrantAuthFilter {
  must: Array<Record<string, unknown>>;
  must_not?: Array<Record<string, unknown>>;
}

export interface CreateStorageBindingInput {
  tenantId: string;
  storageKind: StorageKind;
  bindingKind: StorageBindingKind;
  bindingKey: string;
  region: string;
  config?: Record<string, unknown>;
}

export interface BootstrapPermission {
  key: string;
  category: PermissionCategory;
  description?: string;
}

export interface BootstrapRole {
  key: string;
  name: string;
  description?: string;
  permissionKeys: string[];
}

export interface BootstrapOrgUnit {
  name: string;
  profileKey?: string;
  metadata?: Record<string, unknown>;
  children?: BootstrapOrgUnit[];
}

export interface BootstrapTemplate {
  tenant: CreateTenantInput;
  rootOrgUnit: BootstrapOrgUnit;
  permissions: BootstrapPermission[];
  roles: BootstrapRole[];
  ownerUser: CreateUserInput;
  ownerRoleKey: string;
}

export interface ResourceSnapshot {
  id: string;
  tenantId: string;
  orgUnitId: string;
  resourceType: string;
  resourceId: string;
  visibility: ResourceVisibility;
  ownerPrincipalId?: string;
  sensitivity?: string;
  metadata?: Record<string, unknown>;
}

export interface GrantSnapshot {
  id: string;
  tenantId: string;
  resourceId: string;
  principalId: string;
  permissionKey: string;
  startsAt?: Date;
  expiresAt?: Date;
  conditions?: Record<string, unknown>;
  createdByPrincipalId?: string;
}

export interface EffectivePermissionSnapshot {
  id: string;
  tenantId: string;
  principalId: string;
  permissionKey: string;
  scopeKind: ScopeKind;
  scopeId: string;
  sourceKind: string;
  sourceId: string;
  startsAt?: Date;
  expiresAt?: Date;
}

export interface AuthzDataSources {
  loadResource?: (tenantId: string, protectedResourceId: string) => Promise<ResourceSnapshot | undefined>;
  listResourceGrants?: (tenantId: string, protectedResourceId: string) => Promise<GrantSnapshot[]>;
  listPrincipalGrants?: (tenantId: string, principalId: string) => Promise<GrantSnapshot[]>;
  listEffectivePermissions?: (
    tenantId: string,
    principalId: string
  ) => Promise<EffectivePermissionSnapshot[]>;
  listEffectivePermissionsForScope?: (
    tenantId: string,
    scopeKind: ScopeKind,
    scopeId: string
  ) => Promise<EffectivePermissionSnapshot[]>;
}
