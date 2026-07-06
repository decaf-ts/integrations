import { BaseModelService, relationId, relationMatch, sameTenant, transactional } from "../utils";
import { EffectivePermissionSnapshot, ScopeKind } from "../types";
import { EffectivePermission } from "../models/effective-permission.model";
import { RoleAssignmentService } from "./role-assignment.service";
import { RolePermissionService } from "./role-permission.service";
import { PermissionService } from "./permission.service";
import { GroupMembershipService } from "./group-membership.service";
import { PrincipalService } from "./principal.service";
import { OrgUnitClosureService } from "./org-unit-closure.service";
import { InheritanceBlockService } from "./inheritance-block.service";

export class EffectivePermissionService extends BaseModelService<EffectivePermission> {
  constructor() {
    super(EffectivePermission);
  }

  async listForPrincipal(tenantId: string, principalId: string, ...args: any[]): Promise<EffectivePermission[]> {
    return (await this.listAll(...args)).filter(
      (permission) => sameTenant(permission.tenant, tenantId) && relationMatch(permission.principal, principalId)
    );
  }

  async listForScope(
    tenantId: string,
    scopeKind: ScopeKind,
    scopeId: string,
    ...args: any[]
  ): Promise<EffectivePermission[]> {
    return (await this.listAll(...args)).filter(
      (permission) => sameTenant(permission.tenant, tenantId) && permission.scopeKind === scopeKind && permission.scopeId === scopeId
    );
  }

  async hasPermission(
    tenantId: string,
    principalId: string,
    permissionKey: string,
    scopeKind: ScopeKind,
    scopeId: string,
    at?: Date,
    ...args: any[]
  ): Promise<boolean> {
    return (await this.listForPrincipal(tenantId, principalId, ...args)).some(
      (permission) =>
        permission.permissionKey === permissionKey &&
        permission.scopeKind === scopeKind &&
        permission.scopeId === scopeId &&
        (!permission.startsAt || !at || permission.startsAt <= at) &&
        (!permission.expiresAt || !at || permission.expiresAt >= at)
    );
  }

  async deleteForPrincipal(tenantId: string, principalId: string, ...args: any[]): Promise<void> {
    for (const row of await this.listForPrincipal(tenantId, principalId, ...args)) {
      await this.deleteById(row.id, ...args);
    }
  }

  async deleteForTenant(tenantId: string, ...args: any[]): Promise<void> {
    for (const row of (await this.listAll(...args)).filter((permission) => sameTenant(permission.tenant, tenantId))) {
      await this.deleteById(row.id, ...args);
    }
  }

  @transactional()
  async rebuildForPrincipal(tenantId: string, principalId: string, ...args: any[]): Promise<EffectivePermission[]> {
    await this.deleteForPrincipal(tenantId, principalId, ...args);

    const roleAssignmentService = new RoleAssignmentService();
    const rolePermissionService = new RolePermissionService();
    const permissionService = new PermissionService();
    const groupMembershipService = new GroupMembershipService();
    const principalService = new PrincipalService();
    const orgUnitClosureService = new OrgUnitClosureService();
    const inheritanceBlockService = new InheritanceBlockService();

    const materialized: EffectivePermissionSnapshot[] = [];
    const sourceAssignments = await roleAssignmentService.listPrincipalAssignments(tenantId, principalId, ...args);
    const groupMemberships = await groupMembershipService.listPrincipalGroups(principalId, ...args);
    const groupAssignments = (
      await Promise.all(
        groupMemberships.map(async (membership) => {
          const groupPrincipal = await principalService.getGroupPrincipal(relationId(membership.tenant), relationId(membership.group), ...args);
          return roleAssignmentService.listPrincipalAssignments(tenantId, groupPrincipal.id, ...args);
        })
      )
    ).flat();

    const assignments = [...sourceAssignments, ...groupAssignments];
    for (const assignment of assignments) {
      const rolePermissions = await rolePermissionService.listRolePermissions(relationId(assignment.role), ...args);
      const permissions = await Promise.all(
        rolePermissions.map(async (rolePermission) =>
          permissionService.findOneBy("id", relationId(rolePermission.permission) as never, ...args)
        )
      );
      for (const permission of permissions) {
        if (!permission) continue;
        const scopeKind = assignment.scopeKind;
        const scopeId = assignment.scopeId;
        const scopes: Array<{ scopeKind: ScopeKind; scopeId: string }> = [];
        if (scopeKind === ScopeKind.Tenant) {
          scopes.push({ scopeKind, scopeId: tenantId });
        } else if (scopeKind === ScopeKind.Resource) {
          scopes.push({ scopeKind, scopeId });
        } else if (scopeKind === ScopeKind.OrgUnit && !assignment.inheritDown) {
          scopes.push({ scopeKind, scopeId });
        } else if (scopeKind === ScopeKind.OrgUnit && assignment.inheritDown) {
          const descendants = await orgUnitClosureService.listDescendants(tenantId, scopeId, ...args);
          scopes.push(...descendants.map((row) => ({ scopeKind, scopeId: relationId(row.descendant) })));
        }

        for (const scoped of scopes) {
          if (
            scopeKind === ScopeKind.OrgUnit &&
            assignment.inheritDown &&
            scoped.scopeId !== scopeId &&
            (await inheritanceBlockService.categoryBlockedForAncestor(
              tenantId,
              scoped.scopeId,
              scopeId,
              permission.category,
              ...args
            ))
          ) {
            continue;
          }
          materialized.push({
            id: "",
            tenantId,
            principalId,
            permissionKey: permission.key,
            scopeKind: scoped.scopeKind,
            scopeId: scoped.scopeId,
            sourceKind: "role_assignment",
            sourceId: assignment.id,
            startsAt: assignment.startsAt,
            expiresAt: assignment.expiresAt,
          });
        }
      }
    }

    const created = await Promise.all(
      materialized.map((permission) =>
        this.create(
          {
            tenant: permission.tenantId,
            principal: permission.principalId,
            permissionKey: permission.permissionKey,
            scopeKind: permission.scopeKind,
            scopeId: permission.scopeId,
            sourceKind: permission.sourceKind,
            sourceId: permission.sourceId,
            startsAt: permission.startsAt,
            expiresAt: permission.expiresAt,
          },
          ...args
        )
      )
    );
    return created;
  }

  @transactional()
  async rebuildForTenant(tenantId: string, ...args: any[]): Promise<void> {
    const principals = (await new PrincipalService().listAll(...args)).filter((principal) => sameTenant(principal.tenant, tenantId));
    for (const principal of principals) {
      await this.rebuildForPrincipal(tenantId, principal.id, ...args);
    }
  }
}
