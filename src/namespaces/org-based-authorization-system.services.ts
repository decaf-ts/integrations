import {
  BaseModelService,
  IsolationTier,
  MembershipStatus,
  PermissionCategory,
  PrincipalKind,
  ResourceVisibility,
  ScopeKind,
  StorageBindingKind,
  StorageKind,
  id,
  relationId,
  transactional,
} from "./org-based-authorization-system";
import type {
  AssignRoleInput,
  BootstrapOrgUnit,
  BootstrapTemplate,
  CreateOrgUnitInput,
  CreatePermissionInput,
  CreateRoleInput,
  CreateStorageBindingInput,
  CreateTenantInput,
  CreateUserInput,
  EffectivePermissionSnapshot,
  GrantResourceInput,
  RegisterResourceInput,
} from "./org-based-authorization-system";
import {
  EffectivePermission,
  Group,
  GroupMembership,
  InheritanceBlock,
  OrgUnit,
  OrgUnitClosure,
  OrgUnitMembership,
  OrgUnitProfile,
  Permission,
  ProtectedResource,
  Principal,
  ResourceGrant,
  Role,
  RoleAssignment,
  RolePermission,
  StorageBinding,
  Tenant,
  TenantMembership,
  TenantProfile,
  User,
} from "./org-based-authorization-system.models";
//
// const nowIso = () => new Date();
// const asArray = <T>(value: T[] | undefined): T[] => value ?? [];
const sameTenant = (rowTenant: unknown, tenantId: string): boolean =>
  relationId(rowTenant as { id: string } | string) === tenantId;
const relationMatch = (value: unknown, target: string | undefined): boolean =>
  target ? relationId(value as { id: string } | string) === target : false;
const lowerSlug = (value: string): string =>
  value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "item";

async function deleteManyById(
  service: BaseModelService<any>,
  rows: Array<{ id: string }>,
  ...args: any[]
): Promise<void> {
  for (const row of rows) {
    await service.deleteById(row.id, ...args);
  }
}

export class TenantProfileService extends BaseModelService<TenantProfile> {
  constructor() {
    super(TenantProfile);
  }

  async createProfile(
    tenantId: string,
    profileKey: string,
    metadata?: Record<string, unknown>,
    ...args: any[]
  ): Promise<TenantProfile> {
    return this.createOne(
      {
        id: id(),
        tenant: tenantId,
        profileKey,
        metadata,
      },
      ...args
    );
  }

  async listForTenant(
    tenantId: string,
    ...args: any[]
  ): Promise<TenantProfile[]> {
    return (await this.listAll(...args)).filter((profile) =>
      relationMatch(profile.tenant, tenantId)
    );
  }

  async deleteForTenant(tenantId: string, ...args: any[]): Promise<void> {
    await deleteManyById(
      this,
      await this.listForTenant(tenantId, ...args),
      ...args
    );
  }
}

export class OrgUnitProfileService extends BaseModelService<OrgUnitProfile> {
  constructor() {
    super(OrgUnitProfile);
  }

  async createProfile(
    orgUnitId: string,
    profileKey: string,
    metadata?: Record<string, unknown>,
    ...args: any[]
  ): Promise<OrgUnitProfile> {
    return this.createOne(
      {
        id: id(),
        orgUnit: orgUnitId,
        profileKey,
        metadata,
      },
      ...args
    );
  }

  async listForOrgUnit(
    orgUnitId: string,
    ...args: any[]
  ): Promise<OrgUnitProfile[]> {
    return (await this.listAll(...args)).filter((profile) =>
      relationMatch(profile.orgUnit, orgUnitId)
    );
  }
}

export class OrgUnitClosureService extends BaseModelService<OrgUnitClosure> {
  constructor() {
    super(OrgUnitClosure);
  }

  async listAncestors(
    tenantId: string,
    orgUnitId: string,
    ...args: any[]
  ): Promise<OrgUnitClosure[]> {
    return (await this.listAll(...args))
      .filter(
        (row) =>
          sameTenant(row.tenant, tenantId) &&
          relationMatch(row.descendant, orgUnitId)
      )
      .sort((left, right) => left.depth - right.depth);
  }

  async listDescendants(
    tenantId: string,
    orgUnitId: string,
    ...args: any[]
  ): Promise<OrgUnitClosure[]> {
    return (await this.listAll(...args))
      .filter(
        (row) =>
          sameTenant(row.tenant, tenantId) &&
          relationMatch(row.ancestor, orgUnitId)
      )
      .sort((left, right) => left.depth - right.depth);
  }

  async isAncestorOf(
    tenantId: string,
    ancestorOrgUnitId: string,
    descendantOrgUnitId: string,
    ...args: any[]
  ): Promise<boolean> {
    return (
      await this.listAncestors(tenantId, descendantOrgUnitId, ...args)
    ).some((row) => relationMatch(row.ancestor, ancestorOrgUnitId));
  }

  async createSelfLink(
    tenantId: string,
    orgUnitId: string,
    ...args: any[]
  ): Promise<OrgUnitClosure> {
    return this.createOne(
      {
        id: id(),
        tenant: tenantId,
        ancestor: orgUnitId,
        descendant: orgUnitId,
        depth: 0,
      },
      ...args
    );
  }

  async insertAncestorLinksForNewChild(
    tenantId: string,
    parentOrgUnitId: string,
    childOrgUnitId: string,
    ...args: any[]
  ): Promise<void> {
    const ancestorLinks = await this.listAncestors(
      tenantId,
      parentOrgUnitId,
      ...args
    );
    await Promise.all(
      ancestorLinks.map((link) =>
        this.createOne(
          {
            id: id(),
            tenant: tenantId,
            ancestor: link.ancestor,
            descendant: childOrgUnitId,
            depth: link.depth + 1,
          },
          ...args
        )
      )
    );
  }

  async deleteLinksForSubtree(
    tenantId: string,
    orgUnitId: string,
    ...args: any[]
  ): Promise<void> {
    const subtree = await this.listDescendants(tenantId, orgUnitId, ...args);
    const descendantIds = new Set([
      orgUnitId,
      ...subtree.map((row) => relationId(row.descendant)),
    ]);
    const ancestorIds = new Set([
      orgUnitId,
      ...subtree.map((row) => relationId(row.ancestor)),
    ]);
    const rows = (await this.listAll(...args)).filter(
      (row) =>
        sameTenant(row.tenant, tenantId) &&
        (descendantIds.has(relationId(row.descendant)) ||
          ancestorIds.has(relationId(row.ancestor)))
    );
    await deleteManyById(this, rows, ...args);
  }
}

export class InheritanceBlockService extends BaseModelService<InheritanceBlock> {
  constructor() {
    super(InheritanceBlock);
  }

  async blockCategory(
    tenantId: string,
    orgUnitId: string,
    permissionCategory: PermissionCategory,
    blockedFromAncestorId?: string,
    reason?: string,
    ...args: any[]
  ): Promise<InheritanceBlock> {
    return this.createOne(
      {
        id: id(),
        tenant: tenantId,
        orgUnit: orgUnitId,
        blockedFromAncestor: blockedFromAncestorId,
        permissionCategory,
        reason,
      },
      ...args
    );
  }

  async unblockCategory(blockId: string, ...args: any[]): Promise<void> {
    await this.deleteById(blockId, ...args);
  }

  async listForOrgUnit(
    tenantId: string,
    orgUnitId: string,
    ...args: any[]
  ): Promise<InheritanceBlock[]> {
    return (await this.listAll(...args)).filter(
      (block) =>
        sameTenant(block.tenant, tenantId) &&
        relationMatch(block.orgUnit, orgUnitId)
    );
  }

  async categoryBlockedForAncestor(
    tenantId: string,
    orgUnitId: string,
    ancestorOrgUnitId: string,
    category: PermissionCategory,
    ...args: any[]
  ): Promise<boolean> {
    return (await this.listForOrgUnit(tenantId, orgUnitId, ...args)).some(
      (block) =>
        block.permissionCategory === category &&
        (!block.blockedFromAncestor ||
          relationMatch(block.blockedFromAncestor, ancestorOrgUnitId))
    );
  }
}

export class TenantService extends BaseModelService<Tenant> {
  constructor() {
    super(Tenant);
  }

  async createTenant(
    input: CreateTenantInput,
    ...args: any[]
  ): Promise<Tenant> {
    return this.createOne(
      {
        id: id(),
        slug: input.slug,
        name: input.name,
        isolationTier: input.isolationTier ?? IsolationTier.Pooled,
      },
      ...args
    );
  }

  async getBySlug(slug: string, ...args: any[]): Promise<Tenant> {
    return this.findOneBy("slug", slug as never, ...args);
  }

  async renameTenant(
    tenantId: string,
    name: string,
    ...args: any[]
  ): Promise<Tenant> {
    return this.updateOne(tenantId, { name }, ...args);
  }

  async changeSlug(
    tenantId: string,
    slug: string,
    ...args: any[]
  ): Promise<Tenant> {
    return this.updateOne(tenantId, { slug }, ...args);
  }

  async setIsolationTier(
    tenantId: string,
    isolationTier: IsolationTier,
    ...args: any[]
  ): Promise<Tenant> {
    return this.updateOne(tenantId, { isolationTier }, ...args);
  }

  async deleteTenantControlled(
    tenantId: string,
    ...args: any[]
  ): Promise<void> {
    await this.deleteById(tenantId, ...args);
  }
}

export class OrgUnitService extends BaseModelService<OrgUnit> {
  constructor() {
    super(OrgUnit);
  }

  private orgUnitPath(parentPath: string | undefined, name: string): string {
    const segment = lowerSlug(name);
    return parentPath
      ? `${parentPath.replace(/\/+$/, "")}/${segment}`
      : `/${segment}`;
  }

  private async createProfileIfNeeded(
    orgUnitId: string,
    profileKey: string | undefined,
    profileMetadata: Record<string, unknown> | undefined,
    ...args: any[]
  ): Promise<void> {
    if (!profileKey) return;
    const profileService = new OrgUnitProfileService();
    await profileService.createProfile(
      orgUnitId,
      profileKey,
      profileMetadata,
      ...args
    );
  }

  @transactional()
  async createRoot(
    tenantId: string,
    name: string,
    metadata?: Record<string, unknown>,
    profileKey?: string,
    profileMetadata?: Record<string, unknown>,
    ...args: any[]
  ): Promise<OrgUnit> {
    const orgUnit = await this.createOne(
      {
        id: id(),
        tenant: tenantId,
        name,
        path: this.orgUnitPath(undefined, name),
        metadata,
      },
      ...args
    );
    await this.createProfileIfNeeded(
      orgUnit.id,
      profileKey,
      profileMetadata,
      ...args
    );
    const closureService = new OrgUnitClosureService();
    await closureService.createSelfLink(tenantId, orgUnit.id, ...args);
    return orgUnit;
  }

  @transactional()
  async createChild(
    input: CreateOrgUnitInput,
    ...args: any[]
  ): Promise<OrgUnit> {
    const parent = input.parentOrgUnitId
      ? await this.getById(input.parentOrgUnitId, ...args)
      : undefined;
    const orgUnit = await this.createOne(
      {
        id: id(),
        tenant: input.tenantId,
        parent: parent?.id ?? input.parentOrgUnitId,
        name: input.name,
        path: this.orgUnitPath(parent?.path, input.name),
        metadata: input.metadata,
      },
      ...args
    );
    await this.createProfileIfNeeded(
      orgUnit.id,
      input.profileKey,
      input.profileMetadata,
      ...args
    );
    const closureService = new OrgUnitClosureService();
    await closureService.createSelfLink(input.tenantId, orgUnit.id, ...args);
    if (input.parentOrgUnitId) {
      await closureService.insertAncestorLinksForNewChild(
        input.tenantId,
        input.parentOrgUnitId,
        orgUnit.id,
        ...args
      );
    }
    return orgUnit;
  }

  async listChildren(
    parentOrgUnitId: string,
    ...args: any[]
  ): Promise<OrgUnit[]> {
    return (await this.listAll(...args)).filter((orgUnit) =>
      relationMatch(orgUnit.parent, parentOrgUnitId)
    );
  }

  async listTenantOrgUnits(
    tenantId: string,
    ...args: any[]
  ): Promise<OrgUnit[]> {
    return (await this.listAll(...args)).filter((orgUnit) =>
      sameTenant(orgUnit.tenant, tenantId)
    );
  }

  async listDescendantOrgUnits(
    tenantId: string,
    orgUnitId: string,
    includeSelf = false,
    ...args: any[]
  ): Promise<OrgUnit[]> {
    const closureService = new OrgUnitClosureService();
    const descendants = await closureService.listDescendants(
      tenantId,
      orgUnitId,
      ...args
    );
    const ids = new Set(descendants.map((row) => relationId(row.descendant)));
    if (includeSelf) ids.add(orgUnitId);
    return (await this.listTenantOrgUnits(tenantId, ...args)).filter(
      (orgUnit) => ids.has(orgUnit.id)
    );
  }

  async listAncestorOrgUnits(
    tenantId: string,
    orgUnitId: string,
    includeSelf = false,
    ...args: any[]
  ): Promise<OrgUnit[]> {
    const closureService = new OrgUnitClosureService();
    const ancestors = await closureService.listAncestors(
      tenantId,
      orgUnitId,
      ...args
    );
    const ids = new Set(ancestors.map((row) => relationId(row.ancestor)));
    if (includeSelf) ids.add(orgUnitId);
    return (await this.listTenantOrgUnits(tenantId, ...args)).filter(
      (orgUnit) => ids.has(orgUnit.id)
    );
  }

  async renameOrgUnit(
    orgUnitId: string,
    name: string,
    ...args: any[]
  ): Promise<OrgUnit> {
    const existing = await this.getById(orgUnitId, ...args);
    return this.updateOne(
      orgUnitId,
      { name, path: this.orgUnitPath(undefined, name) },
      ...args
    ).then(async (updated) => {
      updated.path = existing.parent
        ? this.orgUnitPath(undefined, name)
        : this.orgUnitPath(undefined, name);
      return updated;
    });
  }

  @transactional()
  async moveOrgUnit(
    tenantId: string,
    orgUnitId: string,
    newParentOrgUnitId: string,
    ...args: any[]
  ): Promise<OrgUnit> {
    const newParent = await this.getById(newParentOrgUnitId, ...args);
    const existing = await this.getById(orgUnitId, ...args);
    const updated = await this.updateOne(
      orgUnitId,
      {
        parent: newParent.id,
        path: this.orgUnitPath(newParent.path, existing.name),
      },
      ...args
    );
    await this.rebuildTenantClosure(tenantId, ...args);
    return updated;
  }

  @transactional()
  async rebuildTenantClosure(tenantId: string, ...args: any[]): Promise<void> {
    const closureService = new OrgUnitClosureService();
    const existingLinks = await closureService.listAll(...args);
    await deleteManyById(
      closureService,
      existingLinks.filter((row) => sameTenant(row.tenant, tenantId)),
      ...args
    );

    const orgUnits = (await this.listTenantOrgUnits(tenantId, ...args)).sort(
      (left, right) => {
        const leftDepth = left.path.split("/").filter(Boolean).length;
        const rightDepth = right.path.split("/").filter(Boolean).length;
        return leftDepth - rightDepth;
      }
    );

    for (const orgUnit of orgUnits) {
      await closureService.createSelfLink(tenantId, orgUnit.id, ...args);
      if (orgUnit.parent) {
        await closureService.insertAncestorLinksForNewChild(
          tenantId,
          relationId(orgUnit.parent),
          orgUnit.id,
          ...args
        );
      }
    }
  }

  @transactional()
  async deleteOrgUnitTree(
    tenantId: string,
    orgUnitId: string,
    ...args: any[]
  ): Promise<void> {
    const closureService = new OrgUnitClosureService();
    const descendants = await this.listDescendantOrgUnits(
      tenantId,
      orgUnitId,
      true,
      ...args
    );
    const descendantIds = new Set(descendants.map((orgUnit) => orgUnit.id));
    const orgUnits = (await this.listTenantOrgUnits(tenantId, ...args)).filter(
      (orgUnit) => descendantIds.has(orgUnit.id)
    );
    await deleteManyById(this, orgUnits, ...args);
    await closureService.deleteLinksForSubtree(tenantId, orgUnitId, ...args);
  }
}

export class UserService extends BaseModelService<User> {
  constructor() {
    super(User);
  }

  async createUser(input: CreateUserInput, ...args: any[]): Promise<User> {
    return this.createOne(
      {
        id: id(),
        email: input.email,
        phone: input.phone,
        displayName: input.displayName,
      },
      ...args
    );
  }

  async getByEmail(email: string, ...args: any[]): Promise<User> {
    return (await this.listAll(...args)).find(
      (user) => user.email === email
    ) as User;
  }

  async updateDisplayName(
    userId: string,
    displayName: string,
    ...args: any[]
  ): Promise<User> {
    return this.updateOne(userId, { displayName }, ...args);
  }

  async updateEmail(
    userId: string,
    email: string | undefined,
    ...args: any[]
  ): Promise<User> {
    return this.updateOne(userId, { email }, ...args);
  }

  async updatePhone(
    userId: string,
    phone: string | undefined,
    ...args: any[]
  ): Promise<User> {
    return this.updateOne(userId, { phone }, ...args);
  }
}

export class PrincipalService extends BaseModelService<Principal> {
  constructor() {
    super(Principal);
  }

  async createPrincipal(
    tenantId: string,
    kind: PrincipalKind,
    subjectId: string,
    ...args: any[]
  ): Promise<Principal> {
    return this.createOne(
      {
        id: id(),
        tenant: tenantId,
        kind,
        subjectId,
      },
      ...args
    );
  }

  async getForSubject(
    tenantId: string,
    kind: PrincipalKind,
    subjectId: string,
    ...args: any[]
  ): Promise<Principal | undefined> {
    return (await this.listAll(...args)).find(
      (principal) =>
        sameTenant(principal.tenant, tenantId) &&
        principal.kind === kind &&
        principal.subjectId === subjectId
    );
  }

  async getOrCreateForSubject(
    tenantId: string,
    kind: PrincipalKind,
    subjectId: string,
    ...args: any[]
  ): Promise<Principal> {
    return (
      (await this.getForSubject(tenantId, kind, subjectId, ...args)) ??
      (await this.createPrincipal(tenantId, kind, subjectId, ...args))
    );
  }

  async getUserPrincipal(
    tenantId: string,
    userId: string,
    ...args: any[]
  ): Promise<Principal> {
    return this.getOrCreateForSubject(
      tenantId,
      PrincipalKind.User,
      userId,
      ...args
    );
  }

  async getGroupPrincipal(
    tenantId: string,
    groupId: string,
    ...args: any[]
  ): Promise<Principal> {
    return this.getOrCreateForSubject(
      tenantId,
      PrincipalKind.Group,
      groupId,
      ...args
    );
  }
}

export class TenantMembershipService extends BaseModelService<TenantMembership> {
  constructor() {
    super(TenantMembership);
  }

  async addUserToTenant(
    tenantId: string,
    userId: string,
    status: MembershipStatus = MembershipStatus.Active,
    ...args: any[]
  ): Promise<TenantMembership> {
    return this.createOne(
      {
        id: id(),
        tenant: tenantId,
        user: userId,
        status,
      },
      ...args
    );
  }

  async setStatus(
    membershipId: string,
    status: MembershipStatus,
    ...args: any[]
  ): Promise<TenantMembership> {
    return this.updateOne(membershipId, { status }, ...args);
  }

  async listUserTenants(
    userId: string,
    ...args: any[]
  ): Promise<TenantMembership[]> {
    return (await this.listAll(...args)).filter((membership) =>
      relationMatch(membership.user, userId)
    );
  }

  async listTenantUsers(
    tenantId: string,
    ...args: any[]
  ): Promise<TenantMembership[]> {
    return (await this.listAll(...args)).filter((membership) =>
      sameTenant(membership.tenant, tenantId)
    );
  }

  async removeUserFromTenant(
    membershipId: string,
    ...args: any[]
  ): Promise<void> {
    await this.deleteById(membershipId, ...args);
  }
}

export class OrgUnitMembershipService extends BaseModelService<OrgUnitMembership> {
  constructor() {
    super(OrgUnitMembership);
  }

  async addUserToOrgUnit(
    tenantId: string,
    orgUnitId: string,
    userId: string,
    status: MembershipStatus = MembershipStatus.Active,
    ...args: any[]
  ): Promise<OrgUnitMembership> {
    return this.createOne(
      {
        id: id(),
        tenant: tenantId,
        orgUnit: orgUnitId,
        user: userId,
        status,
      },
      ...args
    );
  }

  async setStatus(
    membershipId: string,
    status: MembershipStatus,
    ...args: any[]
  ): Promise<OrgUnitMembership> {
    return this.updateOne(membershipId, { status }, ...args);
  }

  async listUserOrgUnits(
    userId: string,
    ...args: any[]
  ): Promise<OrgUnitMembership[]> {
    return (await this.listAll(...args)).filter((membership) =>
      relationMatch(membership.user, userId)
    );
  }

  async listOrgUnitUsers(
    orgUnitId: string,
    ...args: any[]
  ): Promise<OrgUnitMembership[]> {
    return (await this.listAll(...args)).filter((membership) =>
      relationMatch(membership.orgUnit, orgUnitId)
    );
  }

  async removeUserFromOrgUnit(
    membershipId: string,
    ...args: any[]
  ): Promise<void> {
    await this.deleteById(membershipId, ...args);
  }
}

export class GroupService extends BaseModelService<Group> {
  constructor() {
    super(Group);
  }

  async createGroup(
    tenantId: string,
    name: string,
    orgUnitId?: string,
    metadata?: Record<string, unknown>,
    ...args: any[]
  ): Promise<Group> {
    return this.createOne(
      {
        id: id(),
        tenant: tenantId,
        orgUnit: orgUnitId,
        name,
        metadata,
      },
      ...args
    );
  }

  async renameGroup(
    groupId: string,
    name: string,
    ...args: any[]
  ): Promise<Group> {
    return this.updateOne(groupId, { name }, ...args);
  }

  async moveGroupToOrgUnit(
    groupId: string,
    orgUnitId: string | undefined,
    ...args: any[]
  ): Promise<Group> {
    return this.updateOne(groupId, { orgUnit: orgUnitId }, ...args);
  }

  async listTenantGroups(tenantId: string, ...args: any[]): Promise<Group[]> {
    return (await this.listAll(...args)).filter((group) =>
      sameTenant(group.tenant, tenantId)
    );
  }
}

export class GroupMembershipService extends BaseModelService<GroupMembership> {
  constructor() {
    super(GroupMembership);
  }

  async addPrincipalToGroup(
    tenantId: string,
    groupId: string,
    principalId: string,
    metadata?: Record<string, unknown>,
    ...args: any[]
  ): Promise<GroupMembership> {
    return this.createOne(
      {
        id: id(),
        tenant: tenantId,
        group: groupId,
        principal: principalId,
        metadata,
      },
      ...args
    );
  }

  async listGroupMembers(
    groupId: string,
    ...args: any[]
  ): Promise<GroupMembership[]> {
    return (await this.listAll(...args)).filter((membership) =>
      relationMatch(membership.group, groupId)
    );
  }

  async listPrincipalGroups(
    principalId: string,
    ...args: any[]
  ): Promise<GroupMembership[]> {
    return (await this.listAll(...args)).filter((membership) =>
      relationMatch(membership.principal, principalId)
    );
  }

  async removePrincipalFromGroup(
    membershipId: string,
    ...args: any[]
  ): Promise<void> {
    await this.deleteById(membershipId, ...args);
  }

  async resolveGroupPrincipalIdsForPrincipal(
    principalId: string,
    ...args: any[]
  ): Promise<string[]> {
    const principalService = new PrincipalService();
    const memberships = await this.listPrincipalGroups(principalId, ...args);
    const principals = await Promise.all(
      memberships.map(async (membership) => {
        const tenantId = relationId(membership.tenant);
        const groupId = relationId(membership.group);
        const principal = await principalService.getGroupPrincipal(
          tenantId,
          groupId,
          ...args
        );
        return principal.id;
      })
    );
    return principals;
  }
}

export class PermissionService extends BaseModelService<Permission> {
  constructor() {
    super(Permission);
  }

  async createPermission(
    input: CreatePermissionInput,
    ...args: any[]
  ): Promise<Permission> {
    return this.createOne(
      {
        id: id(),
        key: input.key,
        category: input.category,
        description: input.description,
      },
      ...args
    );
  }

  async getByKey(key: string, ...args: any[]): Promise<Permission> {
    return (await this.listAll(...args)).find(
      (permission) => permission.key === key
    ) as Permission;
  }

  async listByCategory(
    category: PermissionCategory,
    ...args: any[]
  ): Promise<Permission[]> {
    return (await this.listAll(...args)).filter(
      (permission) => permission.category === category
    );
  }

  async updateDescription(
    permissionId: string,
    description: string | undefined,
    ...args: any[]
  ): Promise<Permission> {
    return this.updateOne(permissionId, { description }, ...args);
  }
}

export class RoleService extends BaseModelService<Role> {
  constructor() {
    super(Role);
  }

  async createRole(input: CreateRoleInput, ...args: any[]): Promise<Role> {
    return this.createOne(
      {
        id: id(),
        tenant: input.tenantId,
        key: input.key,
        name: input.name,
        description: input.description,
        metadata: input.metadata,
      },
      ...args
    );
  }

  async getSystemRoleByKey(key: string, ...args: any[]): Promise<Role> {
    const role = (await this.listAll(...args)).find(
      (candidate) => !candidate.tenant && candidate.key === key
    );
    if (!role) {
      throw new Error(`Role "${key}" not found`);
    }
    return role;
  }

  async getTenantRoleByKey(
    tenantId: string,
    key: string,
    ...args: any[]
  ): Promise<Role> {
    const role = (await this.listAll(...args)).find(
      (candidate) =>
        sameTenant(candidate.tenant, tenantId) && candidate.key === key
    );
    if (!role) {
      throw new Error(`Role "${key}" not found for tenant ${tenantId}`);
    }
    return role;
  }

  async renameRole(
    roleId: string,
    name: string,
    ...args: any[]
  ): Promise<Role> {
    return this.updateOne(roleId, { name }, ...args);
  }

  async updateRoleMetadata(
    roleId: string,
    metadata: Record<string, unknown> | undefined,
    ...args: any[]
  ): Promise<Role> {
    return this.updateOne(roleId, { metadata }, ...args);
  }

  async listTenantRoles(
    tenantId: string,
    includeSystem = false,
    ...args: any[]
  ): Promise<Role[]> {
    return (await this.listAll(...args)).filter((role) =>
      includeSystem
        ? !role.tenant || sameTenant(role.tenant, tenantId)
        : sameTenant(role.tenant, tenantId)
    );
  }
}

export class RolePermissionService extends BaseModelService<RolePermission> {
  constructor() {
    super(RolePermission);
  }

  async addPermissionToRole(
    roleId: string,
    permissionId: string,
    ...args: any[]
  ): Promise<RolePermission> {
    return this.createOne(
      {
        id: id(),
        role: roleId,
        permission: permissionId,
      },
      ...args
    );
  }

  async addPermissionKeyToRole(
    roleId: string,
    permissionKey: string,
    ...args: any[]
  ): Promise<RolePermission> {
    const permission = await new PermissionService().getByKey(
      permissionKey,
      ...args
    );
    return this.addPermissionToRole(roleId, permission.id, ...args);
  }

  async removePermissionFromRole(
    rolePermissionId: string,
    ...args: any[]
  ): Promise<void> {
    await this.deleteById(rolePermissionId, ...args);
  }

  async listRolePermissions(
    roleId: string,
    ...args: any[]
  ): Promise<RolePermission[]> {
    return (await this.listAll(...args)).filter((rolePermission) =>
      relationMatch(rolePermission.role, roleId)
    );
  }

  async listPermissionRoles(
    permissionId: string,
    ...args: any[]
  ): Promise<RolePermission[]> {
    return (await this.listAll(...args)).filter((rolePermission) =>
      relationMatch(rolePermission.permission, permissionId)
    );
  }

  @transactional()
  async replaceRolePermissions(
    roleId: string,
    permissionIds: string[],
    ...args: any[]
  ): Promise<RolePermission[]> {
    const existing = await this.listRolePermissions(roleId, ...args);
    await deleteManyById(this, existing, ...args);
    const created = await Promise.all(
      permissionIds.map((permissionId) =>
        this.addPermissionToRole(roleId, permissionId, ...args)
      )
    );
    return created;
  }

  @transactional()
  async createRoleWithPermissions(
    input: CreateRoleInput,
    permissionKeys: string[],
    ...args: any[]
  ): Promise<Role> {
    const role = await new RoleService().createRole(input, ...args);
    for (const permissionKey of permissionKeys) {
      await this.addPermissionKeyToRole(role.id, permissionKey, ...args);
    }
    return role;
  }
}

export class RoleAssignmentService extends BaseModelService<RoleAssignment> {
  constructor() {
    super(RoleAssignment);
  }

  async assignRole(
    input: AssignRoleInput,
    ...args: any[]
  ): Promise<RoleAssignment> {
    return this.createOne(
      {
        id: id(),
        tenant: input.tenantId,
        principal: input.principalId,
        role: input.roleId,
        scopeKind: input.scopeKind,
        scopeId: input.scopeId,
        inheritDown: input.inheritDown ?? false,
        startsAt: input.startsAt,
        expiresAt: input.expiresAt,
        conditions: input.conditions,
      },
      ...args
    );
  }

  async revokeAssignment(assignmentId: string, ...args: any[]): Promise<void> {
    await this.deleteById(assignmentId, ...args);
  }

  async listPrincipalAssignments(
    tenantId: string,
    principalId: string,
    ...args: any[]
  ): Promise<RoleAssignment[]> {
    return (await this.listAll(...args)).filter(
      (assignment) =>
        sameTenant(assignment.tenant, tenantId) &&
        relationMatch(assignment.principal, principalId)
    );
  }

  async listRoleAssignments(
    roleId: string,
    ...args: any[]
  ): Promise<RoleAssignment[]> {
    return (await this.listAll(...args)).filter((assignment) =>
      relationMatch(assignment.role, roleId)
    );
  }

  async listTenantAssignments(
    tenantId: string,
    ...args: any[]
  ): Promise<RoleAssignment[]> {
    return (await this.listAll(...args)).filter((assignment) =>
      sameTenant(assignment.tenant, tenantId)
    );
  }

  async updateAssignmentWindow(
    assignmentId: string,
    startsAt: Date | undefined,
    expiresAt: Date | undefined,
    ...args: any[]
  ): Promise<RoleAssignment> {
    return this.updateOne(assignmentId, { startsAt, expiresAt }, ...args);
  }
}

export class EffectivePermissionService extends BaseModelService<EffectivePermission> {
  constructor() {
    super(EffectivePermission);
  }

  async listForPrincipal(
    tenantId: string,
    principalId: string,
    ...args: any[]
  ): Promise<EffectivePermission[]> {
    return (await this.listAll(...args)).filter(
      (permission) =>
        sameTenant(permission.tenant, tenantId) &&
        relationMatch(permission.principal, principalId)
    );
  }

  async listForScope(
    tenantId: string,
    scopeKind: ScopeKind,
    scopeId: string,
    ...args: any[]
  ): Promise<EffectivePermission[]> {
    return (await this.listAll(...args)).filter(
      (permission) =>
        sameTenant(permission.tenant, tenantId) &&
        permission.scopeKind === scopeKind &&
        permission.scopeId === scopeId
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

  async deleteForPrincipal(
    tenantId: string,
    principalId: string,
    ...args: any[]
  ): Promise<void> {
    await deleteManyById(
      this,
      await this.listForPrincipal(tenantId, principalId, ...args),
      ...args
    );
  }

  async deleteForTenant(tenantId: string, ...args: any[]): Promise<void> {
    await deleteManyById(
      this,
      (await this.listAll(...args)).filter((permission) =>
        sameTenant(permission.tenant, tenantId)
      ),
      ...args
    );
  }

  @transactional()
  async rebuildForPrincipal(
    tenantId: string,
    principalId: string,
    ...args: any[]
  ): Promise<EffectivePermission[]> {
    await this.deleteForPrincipal(tenantId, principalId, ...args);

    const roleAssignmentService = new RoleAssignmentService();
    const rolePermissionService = new RolePermissionService();
    const permissionService = new PermissionService();
    const groupMembershipService = new GroupMembershipService();
    const principalService = new PrincipalService();
    const orgUnitClosureService = new OrgUnitClosureService();
    const inheritanceBlockService = new InheritanceBlockService();

    const materialized: EffectivePermissionSnapshot[] = [];
    const sourceAssignments =
      await roleAssignmentService.listPrincipalAssignments(
        tenantId,
        principalId,
        ...args
      );
    const groupMemberships = await groupMembershipService.listPrincipalGroups(
      principalId,
      ...args
    );
    const groupAssignments = (
      await Promise.all(
        groupMemberships.map(async (membership) => {
          const groupPrincipal = await principalService.getGroupPrincipal(
            relationId(membership.tenant),
            relationId(membership.group),
            ...args
          );
          return roleAssignmentService.listPrincipalAssignments(
            tenantId,
            groupPrincipal.id,
            ...args
          );
        })
      )
    ).flat();

    const assignments = [...sourceAssignments, ...groupAssignments];
    for (const assignment of assignments) {
      const rolePermissions = await rolePermissionService.listRolePermissions(
        relationId(assignment.role),
        ...args
      );
      const permissions = await Promise.all(
        rolePermissions.map(async (rolePermission) => {
          const permission = await permissionService.findOneBy(
            "id",
            relationId(rolePermission.permission) as never,
            ...args
          );
          return permission;
        })
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
          const descendants = await orgUnitClosureService.listDescendants(
            tenantId,
            scopeId,
            ...args
          );
          scopes.push(
            ...descendants.map((row) => ({
              scopeKind,
              scopeId: relationId(row.descendant),
            }))
          );
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
            id: id(),
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
        this.createOne(
          {
            id: permission.id,
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
    const principals = (await new PrincipalService().listAll(...args)).filter(
      (principal) => sameTenant(principal.tenant, tenantId)
    );
    for (const principal of principals) {
      await this.rebuildForPrincipal(tenantId, principal.id, ...args);
    }
  }
}

export class ProtectedResourceService extends BaseModelService<ProtectedResource> {
  constructor() {
    super(ProtectedResource);
  }

  async registerResource(
    input: RegisterResourceInput,
    ...args: any[]
  ): Promise<ProtectedResource> {
    return this.createOne(
      {
        id: id(),
        tenant: input.tenantId,
        orgUnit: input.orgUnitId,
        resourceType: input.resourceType,
        resourceId: input.resourceId,
        visibility: input.visibility,
        owner: input.ownerPrincipalId,
        sensitivity: input.sensitivity,
        metadata: input.metadata,
      },
      ...args
    );
  }

  async getByDomainResource(
    tenantId: string,
    resourceType: string,
    resourceId: string,
    ...args: any[]
  ): Promise<ProtectedResource | undefined> {
    return (await this.listAll(...args)).find(
      (resource) =>
        sameTenant(resource.tenant, tenantId) &&
        resource.resourceType === resourceType &&
        resource.resourceId === resourceId
    );
  }

  async moveResourceToOrgUnit(
    protectedResourceId: string,
    orgUnitId: string,
    ...args: any[]
  ): Promise<ProtectedResource> {
    return this.updateOne(protectedResourceId, { orgUnit: orgUnitId }, ...args);
  }

  async setVisibility(
    protectedResourceId: string,
    visibility: ResourceVisibility,
    ...args: any[]
  ): Promise<ProtectedResource> {
    return this.updateOne(protectedResourceId, { visibility }, ...args);
  }

  async transferOwnership(
    protectedResourceId: string,
    ownerPrincipalId: string | undefined,
    ...args: any[]
  ): Promise<ProtectedResource> {
    return this.updateOne(
      protectedResourceId,
      { owner: ownerPrincipalId },
      ...args
    );
  }

  async listOrgUnitResources(
    orgUnitId: string,
    ...args: any[]
  ): Promise<ProtectedResource[]> {
    return (await this.listAll(...args)).filter((resource) =>
      relationMatch(resource.orgUnit, orgUnitId)
    );
  }

  async listTenantResources(
    tenantId: string,
    ...args: any[]
  ): Promise<ProtectedResource[]> {
    return (await this.listAll(...args)).filter((resource) =>
      sameTenant(resource.tenant, tenantId)
    );
  }
}

export class ResourceGrantService extends BaseModelService<ResourceGrant> {
  constructor() {
    super(ResourceGrant);
  }

  async grantResource(
    input: GrantResourceInput,
    ...args: any[]
  ): Promise<ResourceGrant> {
    return this.createOne(
      {
        id: id(),
        tenant: input.tenantId,
        resource: input.resourceId,
        principal: input.principalId,
        permissionKey: input.permissionKey,
        startsAt: input.startsAt,
        expiresAt: input.expiresAt,
        conditions: input.conditions,
        createdBy: input.createdByPrincipalId,
      },
      ...args
    );
  }

  async revokeGrant(grantId: string, ...args: any[]): Promise<void> {
    await this.deleteById(grantId, ...args);
  }

  async listResourceGrants(
    protectedResourceId: string,
    ...args: any[]
  ): Promise<ResourceGrant[]> {
    return (await this.listAll(...args)).filter((grant) =>
      relationMatch(grant.resource, protectedResourceId)
    );
  }

  async listPrincipalGrants(
    tenantId: string,
    principalId: string,
    ...args: any[]
  ): Promise<ResourceGrant[]> {
    return (await this.listAll(...args)).filter(
      (grant) =>
        sameTenant(grant.tenant, tenantId) &&
        relationMatch(grant.principal, principalId)
    );
  }

  async hasGrant(
    tenantId: string,
    principalId: string,
    protectedResourceId: string,
    permissionKey: string,
    at?: Date,
    ...args: any[]
  ): Promise<boolean> {
    return (
      await this.listPrincipalGrants(tenantId, principalId, ...args)
    ).some(
      (grant) =>
        relationMatch(grant.resource, protectedResourceId) &&
        grant.permissionKey === permissionKey &&
        (!grant.startsAt || !at || grant.startsAt <= at) &&
        (!grant.expiresAt || !at || grant.expiresAt >= at)
    );
  }

  async deleteAllForResource(
    protectedResourceId: string,
    ...args: any[]
  ): Promise<void> {
    await deleteManyById(
      this,
      await this.listResourceGrants(protectedResourceId, ...args),
      ...args
    );
  }
}

export class ResourceLifecycleService {
  async unregisterResource(
    protectedResourceId: string,
    ...args: any[]
  ): Promise<void> {
    await new ResourceGrantService().deleteAllForResource(
      protectedResourceId,
      ...args
    );
    await new ProtectedResourceService().deleteById(
      protectedResourceId,
      ...args
    );
  }

  async resolveResourceScope(
    protectedResourceId: string,
    ...args: any[]
  ): Promise<{
    tenantId: string;
    orgUnitId: string;
    visibility: ResourceVisibility;
    ownerPrincipalId?: string;
  }> {
    const resource = await new ProtectedResourceService().getById(
      protectedResourceId,
      ...args
    );
    return {
      tenantId: relationId(resource.tenant),
      orgUnitId: relationId(resource.orgUnit),
      visibility: resource.visibility,
      ownerPrincipalId: resource.owner ? relationId(resource.owner) : undefined,
    };
  }
}

export class StorageBindingService extends BaseModelService<StorageBinding> {
  constructor() {
    super(StorageBinding);
  }

  async createBinding(
    input: CreateStorageBindingInput,
    ...args: any[]
  ): Promise<StorageBinding> {
    return this.createOne(
      {
        id: id(),
        tenant: input.tenantId,
        storageKind: input.storageKind,
        bindingKind: input.bindingKind,
        bindingKey: input.bindingKey,
        region: input.region,
        config: input.config,
      },
      ...args
    );
  }

  async listTenantBindings(
    tenantId: string,
    ...args: any[]
  ): Promise<StorageBinding[]> {
    return (await this.listAll(...args)).filter((binding) =>
      sameTenant(binding.tenant, tenantId)
    );
  }

  async getBinding(
    tenantId: string,
    storageKind: StorageKind,
    ...args: any[]
  ): Promise<StorageBinding | undefined> {
    return (await this.listTenantBindings(tenantId, ...args)).find(
      (binding) => binding.storageKind === storageKind
    );
  }

  async setBindingConfig(
    bindingId: string,
    config: Record<string, unknown> | undefined,
    ...args: any[]
  ): Promise<StorageBinding> {
    return this.updateOne(bindingId, { config }, ...args);
  }

  async promoteToDedicated(
    bindingId: string,
    bindingKey: string,
    region: string,
    config?: Record<string, unknown>,
    ...args: any[]
  ): Promise<StorageBinding> {
    return this.updateOne(
      bindingId,
      { bindingKind: StorageBindingKind.Dedicated, bindingKey, region, config },
      ...args
    );
  }

  async setShared(
    bindingId: string,
    bindingKey: string,
    region: string,
    config?: Record<string, unknown>,
    ...args: any[]
  ): Promise<StorageBinding> {
    return this.updateOne(
      bindingId,
      { bindingKind: StorageBindingKind.Shared, bindingKey, region, config },
      ...args
    );
  }
}

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
  ): Promise<{
    tenantId: string;
    rootOrgUnitId: string;
    ownerUserId: string;
    ownerPrincipalId: string;
  }> {
    const tenant = await this.tenantService.createTenant(
      template.tenant,
      ...args
    );
    if (template.tenant.profileKey) {
      await this.tenantProfileService.createProfile(
        tenant.id,
        template.tenant.profileKey,
        template.tenant.profileMetadata,
        ...args
      );
    }

    const createOrgTree = async (
      parentId: string | undefined,
      orgUnit: BootstrapOrgUnit
    ): Promise<OrgUnit> => {
      const created =
        parentId === undefined
          ? await this.orgUnitService.createRoot(
              tenant.id,
              orgUnit.name,
              orgUnit.metadata,
              orgUnit.profileKey,
              orgUnit.metadata,
              ...args
            )
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
    const owner = await this.userService.createUser(
      template.ownerUser,
      ...args
    );
    await this.membershipService.addUserToTenant(
      tenant.id,
      owner.id,
      MembershipStatus.Active,
      ...args
    );
    const ownerPrincipal = await this.principalService.getUserPrincipal(
      tenant.id,
      owner.id,
      ...args
    );

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
        await this.rolePermissionService.addPermissionKeyToRole(
          createdRole.id,
          permissionKey,
          ...args
        );
      }
    }

    const ownerRole = await this.roleService.getTenantRoleByKey(
      tenant.id,
      template.ownerRoleKey,
      ...args
    );
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
    await this.effectivePermissionService.rebuildForPrincipal(
      tenant.id,
      ownerPrincipal.id,
      ...args
    );

    return {
      tenantId: tenant.id,
      rootOrgUnitId: rootOrgUnit.id,
      ownerUserId: owner.id,
      ownerPrincipalId: ownerPrincipal.id,
    };
  }
}

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
    await this.membershipService.addUserToTenant(
      tenantId,
      userId,
      MembershipStatus.Active,
      ...args
    );
    await this.orgMembershipService.addUserToOrgUnit(
      tenantId,
      orgUnitId,
      userId,
      MembershipStatus.Active,
      ...args
    );
    const principal = await this.principalService.getUserPrincipal(
      tenantId,
      userId,
      ...args
    );
    const role = await this.roleService.getTenantRoleByKey(
      tenantId,
      roleKey,
      ...args
    );
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
    await this.effectivePermissionService.rebuildForPrincipal(
      tenantId,
      principal.id,
      ...args
    );
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
    const role = await this.roleService.getTenantRoleByKey(
      tenantId,
      roleKey,
      ...args
    );
    const currentAssignments =
      await this.roleAssignmentService.listPrincipalAssignments(
        tenantId,
        principalId,
        ...args
      );
    for (const assignment of currentAssignments.filter(
      (row) => row.scopeKind === ScopeKind.OrgUnit && row.scopeId === orgUnitId
    )) {
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
    await this.effectivePermissionService.rebuildForPrincipal(
      tenantId,
      principalId,
      ...args
    );
  }

  @transactional()
  async suspendUserInTenant(
    tenantMembershipId: string,
    tenantId: string,
    principalId: string,
    ...args: any[]
  ): Promise<void> {
    await this.membershipService.setStatus(
      tenantMembershipId,
      MembershipStatus.Suspended,
      ...args
    );
    await this.effectivePermissionService.deleteForPrincipal(
      tenantId,
      principalId,
      ...args
    );
  }

  @transactional()
  async reactivateUserInTenant(
    tenantMembershipId: string,
    tenantId: string,
    principalId: string,
    ...args: any[]
  ): Promise<void> {
    await this.membershipService.setStatus(
      tenantMembershipId,
      MembershipStatus.Active,
      ...args
    );
    await this.effectivePermissionService.rebuildForPrincipal(
      tenantId,
      principalId,
      ...args
    );
  }
}
