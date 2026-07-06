import { AuthorizationError } from "@decaf-ts/core";
import { AuthzDataSources, CanAccessInput, ResourceVisibility, ScopeKind } from "../types";
import { asArray, buildAccessContext, buildArangoContext, buildQdrantFilter, isTimeValid, relationId } from "../utils";

function scopeKey(scopeKind: ScopeKind, scopeId: string): string {
  return `${scopeKind}:${scopeId}`;
}

export class AuthzService {
  private readonly dataSources: AuthzDataSources;

  constructor(dataSources: AuthzDataSources = {}) {
    this.dataSources = dataSources;
  }

  async canAccess(input: CanAccessInput, ...args: any[]): Promise<boolean> {
    const at = input.at ?? new Date();

    if (input.scopeKind && input.scopeId) {
      const permissions = await this.dataSources.listEffectivePermissionsForScope?.(input.tenantId, input.scopeKind, input.scopeId);
      return asArray(permissions).some(
        (permission) => permission.permissionKey === input.permissionKey && isTimeValid(at, permission.startsAt, permission.expiresAt)
      );
    }

    if (!input.resourceProtectedId) return false;

    const resource = await this.dataSources.loadResource?.(input.tenantId, input.resourceProtectedId);
    if (!resource) return false;
    if (resource.tenantId !== input.tenantId) return false;

    if (resource.ownerPrincipalId === input.principalId) return true;

    const grants = asArray(await this.dataSources.listResourceGrants?.(input.tenantId, input.resourceProtectedId)).filter(
      (grant) => grant.principalId === input.principalId && grant.permissionKey === input.permissionKey && isTimeValid(at, grant.startsAt, grant.expiresAt)
    );
    if (grants.length > 0) return true;

    const visibility = resource.visibility;
    if (visibility === ResourceVisibility.Private || visibility === ResourceVisibility.ResourceAcl) {
      return false;
    }

    if (visibility === ResourceVisibility.OrgUnit || visibility === ResourceVisibility.OrgSubtree) {
      const effectivePermissions = asArray(
        await this.dataSources.listEffectivePermissionsForScope?.(input.tenantId, ScopeKind.OrgUnit, resource.orgUnitId)
      );
      return effectivePermissions.some(
        (permission) => permission.permissionKey === input.permissionKey && isTimeValid(at, permission.startsAt, permission.expiresAt)
      );
    }

    if (visibility === ResourceVisibility.Tenant) {
      const effectivePermissions = asArray(
        await this.dataSources.listEffectivePermissionsForScope?.(input.tenantId, ScopeKind.Tenant, input.tenantId)
      );
      return effectivePermissions.some(
        (permission) => permission.permissionKey === input.permissionKey && isTimeValid(at, permission.startsAt, permission.expiresAt)
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

  async buildAccessContext(tenantId: string, principalId: string, ...args: any[]): Promise<import("../types").AccessContext> {
    const permissions = asArray(await this.dataSources.listEffectivePermissions?.(tenantId, principalId));
    const grants = asArray(await this.dataSources.listPrincipalGrants?.(tenantId, principalId));
    return buildAccessContext({
      tenantId,
      principalId,
      permissions,
      grants,
    });
  }

  async buildArangoContext(tenantId: string, principalId: string, permissionKey: string, ...args: any[]) {
    const access = await this.buildAccessContext(tenantId, principalId, ...args);
    const allowedOrgUnitIds = access.allowedOrgUnitIdsByPermission[permissionKey] ?? [];
    const allowedResourceIds = access.resourceGrants.filter((grant) => grant.permissionKey === permissionKey).map((grant) => grant.resourceId);
    return buildArangoContext({ tenantId, principalId, permissionKey, allowedOrgUnitIds, allowedResourceIds });
  }

  async buildQdrantFilter(tenantId: string, principalId: string, permissionKey: string, ...args: any[]) {
    const access = await this.buildAccessContext(tenantId, principalId, ...args);
    const allowedOrgUnitIds = access.allowedOrgUnitIdsByPermission[permissionKey] ?? [];
    const allowedResourceIds = access.resourceGrants.filter((grant) => grant.permissionKey === permissionKey).map((grant) => grant.resourceId);
    return buildQdrantFilter({ tenantId, principalId, permissionKey, allowedOrgUnitIds, allowedResourceIds });
  }
}
