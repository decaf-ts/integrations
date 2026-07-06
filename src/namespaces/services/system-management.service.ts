import { transactional } from "../utils";
import { MembershipStatus, ScopeKind } from "../types";
import { TenantMembershipService } from "./tenant-membership.service";
import { OrgUnitMembershipService } from "./org-unit-membership.service";
import { PrincipalService } from "./principal.service";
import { RoleService } from "./role.service";
import { RoleAssignmentService } from "./role-assignment.service";
import { EffectivePermissionService } from "./effective-permission.service";

export class SystemManagementService {
  private membershipService = new TenantMembershipService();
  private orgMembershipService = new OrgUnitMembershipService();
  private principalService = new PrincipalService();
  private roleService = new RoleService();
  private roleAssignmentService = new RoleAssignmentService();
  private effectivePermissionService = new EffectivePermissionService();

  @transactional()
  async onboardUserToTenantAndOrgUnit(
    tenantId: string,
    userId: string,
    orgUnitId: string,
    roleKey: string,
    ...args: any[]
  ): Promise<{ principalId: string }> {
    await this.membershipService.addUserToTenant(tenantId, userId, MembershipStatus.Active, ...args);
    await this.orgMembershipService.addUserToOrgUnit(tenantId, orgUnitId, userId, MembershipStatus.Active, ...args);
    const principal = await this.principalService.getUserPrincipal(tenantId, userId, ...args);
    const role = await this.roleService.getTenantRoleByKey(tenantId, roleKey, ...args);
    await this.roleAssignmentService.assignRole(
      {
        tenantId,
        principalId: principal.id,
        roleId: role.id,
        scopeKind: ScopeKind.OrgUnit,
        scopeId: orgUnitId,
        inheritDown: true,
      },
      ...args
    );
    await this.effectivePermissionService.rebuildForPrincipal(tenantId, principal.id, ...args);
    return { principalId: principal.id };
  }

  @transactional()
  async changeUserOrgRole(
    tenantId: string,
    principalId: string,
    orgUnitId: string,
    roleKey: string,
    inheritDown: boolean,
    ...args: any[]
  ): Promise<void> {
    const role = await this.roleService.getTenantRoleByKey(tenantId, roleKey, ...args);
    const currentAssignments = await this.roleAssignmentService.listPrincipalAssignments(tenantId, principalId, ...args);
    for (const assignment of currentAssignments.filter((row) => row.scopeKind === ScopeKind.OrgUnit && row.scopeId === orgUnitId)) {
      await this.roleAssignmentService.revokeAssignment(assignment.id, ...args);
    }
    await this.roleAssignmentService.assignRole(
      {
        tenantId,
        principalId,
        roleId: role.id,
        scopeKind: ScopeKind.OrgUnit,
        scopeId: orgUnitId,
        inheritDown,
      },
      ...args
    );
    await this.effectivePermissionService.rebuildForPrincipal(tenantId, principalId, ...args);
  }

  @transactional()
  async suspendUserInTenant(tenantMembershipId: string, tenantId: string, principalId: string, ...args: any[]): Promise<void> {
    await this.membershipService.setStatus(tenantMembershipId, MembershipStatus.Suspended, ...args);
    await this.effectivePermissionService.deleteForPrincipal(tenantId, principalId, ...args);
  }

  @transactional()
  async reactivateUserInTenant(tenantMembershipId: string, tenantId: string, principalId: string, ...args: any[]): Promise<void> {
    await this.membershipService.setStatus(tenantMembershipId, MembershipStatus.Active, ...args);
    await this.effectivePermissionService.rebuildForPrincipal(tenantId, principalId, ...args);
  }
}
