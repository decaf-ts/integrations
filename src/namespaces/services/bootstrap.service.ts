import { transactional } from "../utils";
import type {
  BootstrapOrgUnit,
  BootstrapTemplate,
} from "../types";
import { MembershipStatus, ScopeKind } from "../types";
import { TenantService } from "./tenant.service";
import { TenantProfileService } from "./tenant-profile.service";
import { OrgUnitService } from "./org-unit.service";
import { OrgUnitProfileService } from "./org-unit-profile.service";
import { UserService } from "./user.service";
import { TenantMembershipService } from "./tenant-membership.service";
import { PrincipalService } from "./principal.service";
import { PermissionService } from "./permission.service";
import { RoleService } from "./role.service";
import { RolePermissionService } from "./role-permission.service";
import { RoleAssignmentService } from "./role-assignment.service";
import { EffectivePermissionService } from "./effective-permission.service";
import { relationId } from "../utils";

export class BootstrapService {
  private tenantService = new TenantService();
  private tenantProfileService = new TenantProfileService();
  private orgUnitService = new OrgUnitService();
  private orgUnitProfileService = new OrgUnitProfileService();
  private userService = new UserService();
  private membershipService = new TenantMembershipService();
  private principalService = new PrincipalService();
  private permissionService = new PermissionService();
  private roleService = new RoleService();
  private rolePermissionService = new RolePermissionService();
  private roleAssignmentService = new RoleAssignmentService();
  private effectivePermissionService = new EffectivePermissionService();

  @transactional()
  async bootstrapTenantFromTemplate(
    template: BootstrapTemplate,
    ...args: any[]
  ): Promise<{ tenantId: string; rootOrgUnitId: string; ownerUserId: string; ownerPrincipalId: string }> {
    const tenant = await this.tenantService.createTenant(template.tenant, ...args);
    if (template.tenant.profileKey) {
      await this.tenantProfileService.createProfile(tenant.id, template.tenant.profileKey, template.tenant.profileMetadata, ...args);
    }

    const createOrgTree = async (parentId: string | undefined, orgUnit: BootstrapOrgUnit) => {
      const created =
        parentId === undefined
          ? await this.orgUnitService.createRoot(tenant.id, orgUnit.name, orgUnit.metadata, orgUnit.profileKey, orgUnit.metadata, ...args)
          : await this.orgUnitService.createChild(
              {
                tenantId: tenant.id,
                parentOrgUnitId: parentId,
                name: orgUnit.name,
                metadata: orgUnit.metadata,
                profileKey: orgUnit.profileKey,
                profileMetadata: orgUnit.metadata,
              },
              ...args
            );
      for (const child of orgUnit.children ?? []) {
        await createOrgTree(created.id, child);
      }
      return created;
    };

    const rootOrgUnit = await createOrgTree(undefined, template.rootOrgUnit);
    const owner = await this.userService.createUser(template.ownerUser, ...args);
    await this.membershipService.addUserToTenant(tenant.id, owner.id, MembershipStatus.Active, ...args);
    const ownerPrincipal = await this.principalService.getUserPrincipal(tenant.id, owner.id, ...args);

    for (const permission of template.permissions) {
      await this.permissionService.createPermission(permission, ...args);
    }
    for (const role of template.roles) {
      const createdRole = await this.roleService.createRole(
        {
          tenantId: tenant.id,
          key: role.key,
          name: role.name,
          description: role.description,
        },
        ...args
      );
      for (const permissionKey of role.permissionKeys) {
        await this.rolePermissionService.addPermissionKeyToRole(createdRole.id, permissionKey, ...args);
      }
    }

    const ownerRole = await this.roleService.getTenantRoleByKey(tenant.id, template.ownerRoleKey, ...args);
    await this.roleAssignmentService.assignRole(
      {
        tenantId: tenant.id,
        principalId: ownerPrincipal.id,
        roleId: ownerRole.id,
        scopeKind: ScopeKind.OrgUnit,
        scopeId: rootOrgUnit.id,
        inheritDown: true,
      },
      ...args
    );
    await this.effectivePermissionService.rebuildForPrincipal(tenant.id, ownerPrincipal.id, ...args);

    return {
      tenantId: tenant.id,
      rootOrgUnitId: rootOrgUnit.id,
      ownerUserId: owner.id,
      ownerPrincipalId: ownerPrincipal.id,
    };
  }
}
