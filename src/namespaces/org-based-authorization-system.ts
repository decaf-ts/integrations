import {
  AuthorizationError,
  Cascade,
  ModelService,
  Repository,
  transactional,
} from "@decaf-ts/core";
import { Model } from "@decaf-ts/decorator-validation";

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

export const REL_RESTRICT = {
  update: Cascade.NONE,
  delete: Cascade.NONE,
  nullable: false,
} as const;

export const REL_NULLIFY = {
  update: Cascade.NONE,
  delete: Cascade.NONE,
  nullable: true,
} as const;

export const REL_CASCADE_DEPENDENT = {
  update: Cascade.CASCADE,
  delete: Cascade.CASCADE,
  nullable: false,
} as const;

export const REL_CASCADE_INSERT_UPDATE = {
  update: Cascade.CASCADE,
  delete: Cascade.NONE,
  nullable: false,
} as const;

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
  loadResource?: (
    tenantId: string,
    protectedResourceId: string
  ) => Promise<ResourceSnapshot | undefined>;
  listResourceGrants?: (
    tenantId: string,
    protectedResourceId: string
  ) => Promise<GrantSnapshot[]>;
  listPrincipalGrants?: (
    tenantId: string,
    principalId: string
  ) => Promise<GrantSnapshot[]>;
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

function isTimeValid(
  at: Date | undefined,
  startsAt?: Date,
  expiresAt?: Date
): boolean {
  const instant = at ?? new Date();
  if (startsAt && instant < startsAt) return false;
  if (expiresAt && instant > expiresAt) return false;
  return true;
}

function scopeKey(scopeKind: ScopeKind, scopeId: string): string {
  return `${scopeKind}:${scopeId}`;
}

function toArray<T>(value: T[] | undefined): T[] {
  return value ?? [];
}

export function buildArangoContext(options: {
  tenantId: string;
  principalId: string;
  permissionKey: string;
  allowedOrgUnitIds: string[];
  allowedResourceIds: string[];
}): ArangoAuthContext {
  return {
    tenantId: options.tenantId,
    principalId: options.principalId,
    permissionKey: options.permissionKey,
    allowedOrgUnitIds: [...options.allowedOrgUnitIds],
    allowedResourceIds: [...options.allowedResourceIds],
  };
}

export function buildQdrantFilter(options: {
  tenantId: string;
  principalId: string;
  permissionKey: string;
  allowedOrgUnitIds: string[];
  allowedResourceIds: string[];
}): QdrantAuthFilter {
  return {
    must: [
      {
        key: "tenant_id",
        match: { value: options.tenantId },
      },
      {
        should: [
          { key: "org_unit_id", match: { any: options.allowedOrgUnitIds } },
          {
            key: "protected_resource_id",
            match: { any: options.allowedResourceIds },
          },
          { key: "owner_principal_id", match: { value: options.principalId } },
        ],
      },
    ],
  };
}

export function buildAccessContext(options: {
  tenantId: string;
  principalId: string;
  permissions: EffectivePermissionSnapshot[];
  grants: GrantSnapshot[];
}): AccessContext {
  const permissionsByScope: Record<string, string[]> = {};
  const allowedOrgUnitIdsByPermission: Record<string, string[]> = {};

  for (const permission of options.permissions) {
    const key = scopeKey(permission.scopeKind, permission.scopeId);
    permissionsByScope[key] = permissionsByScope[key] ?? [];
    permissionsByScope[key].push(permission.permissionKey);
    if (permission.scopeKind === ScopeKind.OrgUnit) {
      allowedOrgUnitIdsByPermission[permission.permissionKey] =
        allowedOrgUnitIdsByPermission[permission.permissionKey] ?? [];
      allowedOrgUnitIdsByPermission[permission.permissionKey].push(
        permission.scopeId
      );
    }
  }

  return {
    tenantId: options.tenantId,
    principalId: options.principalId,
    permissionsByScope,
    allowedOrgUnitIdsByPermission,
    resourceGrants: options.grants.map((grant) => ({
      resourceId: grant.resourceId,
      permissionKey: grant.permissionKey,
    })),
  };
}

export abstract class BaseModelService<
  M extends Model<boolean> & { id: string },
> extends ModelService<M, Repository<M, any>> {
  protected constructor(clazz: new () => M) {
    super(clazz);
  }

  protected newModel<T>(clazz: new () => T, data: Partial<T>): T {
    return Object.assign(new clazz() as object, data as object) as T;
  }

  async createOne(data: Partial<M>, ...args: any[]): Promise<M> {
    return this.repo.create(Object.assign({} as M, data as object), ...args);
  }

  async getById(id: string, ...args: any[]): Promise<M> {
    return this.repo.read(id, ...args);
  }

  async updateOne(id: string, patch: Partial<M>, ...args: any[]): Promise<M> {
    const existing = await this.repo.read(id, ...args);
    return this.repo.update(Object.assign(existing, patch), ...args);
  }

  async deleteById(id: string, ...args: any[]): Promise<void> {
    await this.repo.delete(id, ...args);
  }

  async findOneBy<K extends keyof M & string>(
    key: K,
    value: M[K],
    ...args: any[]
  ): Promise<M> {
    return this.repo.findOneBy(key, value, ...args);
  }

  async findManyBy<K extends keyof M & string>(
    key: K,
    value: M[K],
    ...args: any[]
  ): Promise<M[]> {
    return this.repo
      .select()
      .where({ [key]: value } as any)
      .execute(...args);
  }

  async listAll(...args: any[]): Promise<M[]> {
    return this.repo.select().execute(...args);
  }
}

export function id(): string {
  return crypto.randomUUID();
}

export function relationId(value: string | { id: string }): string {
  return typeof value === "string" ? value : value.id;
}

export class AuthzService {
  private readonly dataSources: AuthzDataSources;

  constructor(dataSources: AuthzDataSources = {}) {
    this.dataSources = dataSources;
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async canAccess(input: CanAccessInput, ...args: any[]): Promise<boolean> {
    const at = input.at ?? new Date();

    if (input.scopeKind && input.scopeId) {
      const permissions =
        await this.dataSources.listEffectivePermissionsForScope?.(
          input.tenantId,
          input.scopeKind,
          input.scopeId
        );
      return toArray(permissions).some(
        (permission) =>
          permission.permissionKey === input.permissionKey &&
          isTimeValid(at, permission.startsAt, permission.expiresAt)
      );
    }

    if (!input.resourceProtectedId) return false;

    const resource = await this.dataSources.loadResource?.(
      input.tenantId,
      input.resourceProtectedId
    );
    if (!resource) return false;
    if (resource.tenantId !== input.tenantId) return false;

    if (resource.ownerPrincipalId === input.principalId) return true;

    const grants = toArray(
      await this.dataSources.listResourceGrants?.(
        input.tenantId,
        input.resourceProtectedId
      )
    ).filter(
      (grant) =>
        grant.principalId === input.principalId &&
        grant.permissionKey === input.permissionKey &&
        isTimeValid(at, grant.startsAt, grant.expiresAt)
    );
    if (grants.length > 0) return true;

    const visibility = resource.visibility;
    if (
      visibility === ResourceVisibility.Private ||
      visibility === ResourceVisibility.ResourceAcl
    ) {
      return false;
    }

    if (
      visibility === ResourceVisibility.OrgUnit ||
      visibility === ResourceVisibility.OrgSubtree
    ) {
      const effectivePermissions = toArray(
        await this.dataSources.listEffectivePermissionsForScope?.(
          input.tenantId,
          ScopeKind.OrgUnit,
          resource.orgUnitId
        )
      );
      return effectivePermissions.some(
        (permission) =>
          permission.permissionKey === input.permissionKey &&
          isTimeValid(at, permission.startsAt, permission.expiresAt)
      );
    }

    if (visibility === ResourceVisibility.Tenant) {
      const effectivePermissions = toArray(
        await this.dataSources.listEffectivePermissionsForScope?.(
          input.tenantId,
          ScopeKind.Tenant,
          input.tenantId
        )
      );
      return effectivePermissions.some(
        (permission) =>
          permission.permissionKey === input.permissionKey &&
          isTimeValid(at, permission.startsAt, permission.expiresAt)
      );
    }

    return false;
  }

  async requireAccess(input: CanAccessInput, ...args: any[]): Promise<void> {
    if (!(await this.canAccess(input, ...args))) {
      throw new AuthorizationError(
        `Access denied for ${input.permissionKey} on ${input.resourceProtectedId ?? scopeKey(input.scopeKind ?? ScopeKind.Resource, input.scopeId ?? "")}`
      );
    }
  }

  async buildAccessContext(
    tenantId: string,
    principalId: string,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    ...args: any[]
  ): Promise<AccessContext> {
    const permissions = toArray(
      await this.dataSources.listEffectivePermissions?.(tenantId, principalId)
    );
    const grants = toArray(
      await this.dataSources.listPrincipalGrants?.(tenantId, principalId)
    );
    return buildAccessContext({
      tenantId,
      principalId,
      permissions,
      grants,
    });
  }

  async buildArangoContext(
    tenantId: string,
    principalId: string,
    permissionKey: string,
    ...args: any[]
  ): Promise<ArangoAuthContext> {
    const access = await this.buildAccessContext(
      tenantId,
      principalId,
      ...args
    );
    const allowedOrgUnitIds =
      access.allowedOrgUnitIdsByPermission[permissionKey] ?? [];
    const allowedResourceIds = access.resourceGrants
      .filter((grant) => grant.permissionKey === permissionKey)
      .map((grant) => grant.resourceId);
    return buildArangoContext({
      tenantId,
      principalId,
      permissionKey,
      allowedOrgUnitIds,
      allowedResourceIds,
    });
  }

  async buildQdrantFilter(
    tenantId: string,
    principalId: string,
    permissionKey: string,
    ...args: any[]
  ): Promise<QdrantAuthFilter> {
    const access = await this.buildAccessContext(
      tenantId,
      principalId,
      ...args
    );
    const allowedOrgUnitIds =
      access.allowedOrgUnitIdsByPermission[permissionKey] ?? [];
    const allowedResourceIds = access.resourceGrants
      .filter((grant) => grant.permissionKey === permissionKey)
      .map((grant) => grant.resourceId);
    return buildQdrantFilter({
      tenantId,
      principalId,
      permissionKey,
      allowedOrgUnitIds,
      allowedResourceIds,
    });
  }
}

export { transactional };
