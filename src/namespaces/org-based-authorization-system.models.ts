import {
  column,
  createdAt,
  manyToOne,
  oneToMany,
  pk,
  table,
  unique,
  updatedAt,
} from "@decaf-ts/core";
import { Model, model, option, required, type as typeOf } from "@decaf-ts/decorator-validation";
import {
  IsolationTier,
  IsolationTierOptions,
  MembershipStatus,
  MembershipStatusOptions,
  PermissionCategory,
  PermissionCategoryOptions,
  PrincipalKind,
  PrincipalKindOptions,
  REL_CASCADE_DEPENDENT,
  REL_NULLIFY,
  REL_RESTRICT,
  ResourceVisibility,
  ResourceVisibilityOptions,
  ScopeKind,
  ScopeKindOptions,
  StorageBindingKind,
  StorageBindingKindOptions,
  StorageKind,
  StorageKindOptions,
} from "./org-based-authorization-system";

export class AuthorizationModel extends Model {
  constructor(data?: unknown) {
    super(data as never);
  }
}

@table("tenants")
@model()
export class Tenant extends AuthorizationModel {
  @pk({ type: String }) id!: string;
  @unique() @required() @typeOf(String) @column() slug!: string;
  @required() @typeOf(String) @column() name!: string;
  @required() @typeOf(String) @option(IsolationTierOptions) @column() isolationTier!: IsolationTier;
  @oneToMany(() => OrgUnit, REL_RESTRICT, false) orgUnits?: OrgUnit[] | string[];
  @oneToMany(() => TenantMembership, REL_RESTRICT, false) memberships?: TenantMembership[] | string[];
  @oneToMany(() => Principal, REL_RESTRICT, false) principals?: Principal[] | string[];
  @oneToMany(() => StorageBinding, REL_RESTRICT, false) storageBindings?: StorageBinding[] | string[];
  @createdAt() createdAt!: Date;
  @updatedAt() updatedAt!: Date;
}

@table("tenant_profiles")
@model()
export class TenantProfile extends AuthorizationModel {
  @pk({ type: String }) id!: string;
  @manyToOne(() => Tenant, REL_CASCADE_DEPENDENT, false, undefined, "fk_tenant_profiles_tenant")
  @required()
  tenant!: Tenant | string;
  @required() @typeOf(String) @column() profileKey!: string;
  @typeOf(Object) @column() metadata?: Record<string, unknown>;
  @createdAt() createdAt!: Date;
  @updatedAt() updatedAt!: Date;
}

@table("org_units")
@model()
export class OrgUnit extends AuthorizationModel {
  @pk({ type: String }) id!: string;
  @manyToOne(() => Tenant, REL_RESTRICT, false, undefined, "fk_org_units_tenant")
  @required()
  tenant!: Tenant | string;
  @manyToOne(() => OrgUnit, REL_RESTRICT, false, undefined, "fk_org_units_parent")
  parent?: OrgUnit | string;
  @oneToMany(() => OrgUnit, REL_RESTRICT, false) children?: OrgUnit[] | string[];
  @required() @typeOf(String) @column() name!: string;
  @required() @typeOf(String) @column() path!: string;
  @typeOf(Object) @column() metadata?: Record<string, unknown>;
  @oneToMany(() => OrgUnitMembership, REL_RESTRICT, false) memberships?: OrgUnitMembership[] | string[];
  @oneToMany(() => ProtectedResource, REL_RESTRICT, false) resources?: ProtectedResource[] | string[];
  @oneToMany(() => InheritanceBlock, REL_RESTRICT, false) inheritanceBlocks?: InheritanceBlock[] | string[];
  @oneToMany(() => OrgUnitClosure, REL_RESTRICT, false) ancestorLinks?: OrgUnitClosure[] | string[];
  @oneToMany(() => OrgUnitClosure, REL_RESTRICT, false) descendantLinks?: OrgUnitClosure[] | string[];
  @createdAt() createdAt!: Date;
  @updatedAt() updatedAt!: Date;
}

@table("org_unit_profiles")
@model()
export class OrgUnitProfile extends AuthorizationModel {
  @pk({ type: String }) id!: string;
  @manyToOne(() => OrgUnit, REL_CASCADE_DEPENDENT, false, undefined, "fk_org_unit_profiles_org_unit")
  @required()
  orgUnit!: OrgUnit | string;
  @required() @typeOf(String) @column() profileKey!: string;
  @typeOf(Object) @column() metadata?: Record<string, unknown>;
  @createdAt() createdAt!: Date;
  @updatedAt() updatedAt!: Date;
}

@table("org_unit_closure")
@model()
export class OrgUnitClosure extends AuthorizationModel {
  @pk({ type: String }) id!: string;
  @manyToOne(() => Tenant, REL_CASCADE_DEPENDENT, false, undefined, "fk_org_closure_tenant")
  @required()
  tenant!: Tenant | string;
  @manyToOne(() => OrgUnit, REL_CASCADE_DEPENDENT, false, undefined, "fk_org_closure_ancestor")
  @required()
  ancestor!: OrgUnit | string;
  @manyToOne(() => OrgUnit, REL_CASCADE_DEPENDENT, false, undefined, "fk_org_closure_descendant")
  @required()
  descendant!: OrgUnit | string;
  @required() @typeOf(Number) @column() depth!: number;
  @createdAt() createdAt!: Date;
}

@table("users")
@model()
export class User extends AuthorizationModel {
  @pk({ type: String }) id!: string;
  @unique() @typeOf(String) @column() email?: string;
  @unique() @typeOf(String) @column() phone?: string;
  @required() @typeOf(String) @column() displayName!: string;
  @oneToMany(() => TenantMembership, REL_RESTRICT, false) tenantMemberships?: TenantMembership[] | string[];
  @oneToMany(() => OrgUnitMembership, REL_RESTRICT, false) orgUnitMemberships?: OrgUnitMembership[] | string[];
  @createdAt() createdAt!: Date;
  @updatedAt() updatedAt!: Date;
}

@table("groups")
@model()
export class Group extends AuthorizationModel {
  @pk({ type: String }) id!: string;
  @manyToOne(() => Tenant, REL_RESTRICT, false, undefined, "fk_groups_tenant")
  @required()
  tenant!: Tenant | string;
  @manyToOne(() => OrgUnit, REL_NULLIFY, false, undefined, "fk_groups_org_unit")
  orgUnit?: OrgUnit | string;
  @required() @typeOf(String) @column() name!: string;
  @typeOf(Object) @column() metadata?: Record<string, unknown>;
  @oneToMany(() => GroupMembership, REL_RESTRICT, false) members?: GroupMembership[] | string[];
  @createdAt() createdAt!: Date;
  @updatedAt() updatedAt!: Date;
}

@table("principals")
@model()
export class Principal extends AuthorizationModel {
  @pk({ type: String }) id!: string;
  @manyToOne(() => Tenant, REL_RESTRICT, false, undefined, "fk_principals_tenant")
  @required()
  tenant!: Tenant | string;
  @required() @typeOf(String) @option(PrincipalKindOptions) @column() kind!: PrincipalKind;
  @required() @typeOf(String) @column() subjectId!: string;
  @oneToMany(() => RoleAssignment, REL_RESTRICT, false) roleAssignments?: RoleAssignment[] | string[];
  @oneToMany(() => ResourceGrant, REL_RESTRICT, false) resourceGrants?: ResourceGrant[] | string[];
  @createdAt() createdAt!: Date;
  @updatedAt() updatedAt!: Date;
}

@table("tenant_memberships")
@model()
export class TenantMembership extends AuthorizationModel {
  @pk({ type: String }) id!: string;
  @manyToOne(() => Tenant, REL_CASCADE_DEPENDENT, false, undefined, "fk_tenant_memberships_tenant")
  @required()
  tenant!: Tenant | string;
  @manyToOne(() => User, REL_CASCADE_DEPENDENT, false, undefined, "fk_tenant_memberships_user")
  @required()
  user!: User | string;
  @required() @typeOf(String) @option(MembershipStatusOptions) @column() status!: MembershipStatus;
  @createdAt() createdAt!: Date;
  @updatedAt() updatedAt!: Date;
}

@table("org_unit_memberships")
@model()
export class OrgUnitMembership extends AuthorizationModel {
  @pk({ type: String }) id!: string;
  @manyToOne(() => Tenant, REL_CASCADE_DEPENDENT, false, undefined, "fk_org_memberships_tenant")
  @required()
  tenant!: Tenant | string;
  @manyToOne(() => OrgUnit, REL_CASCADE_DEPENDENT, false, undefined, "fk_org_memberships_org_unit")
  @required()
  orgUnit!: OrgUnit | string;
  @manyToOne(() => User, REL_RESTRICT, false, undefined, "fk_org_memberships_user")
  @required()
  user!: User | string;
  @required() @typeOf(String) @option(MembershipStatusOptions) @column() status!: MembershipStatus;
  @createdAt() createdAt!: Date;
  @updatedAt() updatedAt!: Date;
}

@table("group_memberships")
@model()
export class GroupMembership extends AuthorizationModel {
  @pk({ type: String }) id!: string;
  @manyToOne(() => Tenant, REL_CASCADE_DEPENDENT, false, undefined, "fk_group_memberships_tenant")
  @required()
  tenant!: Tenant | string;
  @manyToOne(() => Group, REL_CASCADE_DEPENDENT, false, undefined, "fk_group_memberships_group")
  @required()
  group!: Group | string;
  @manyToOne(() => Principal, REL_CASCADE_DEPENDENT, false, undefined, "fk_group_memberships_principal")
  @required()
  principal!: Principal | string;
  @typeOf(Object) @column() metadata?: Record<string, unknown>;
  @createdAt() createdAt!: Date;
}

@table("permissions")
@model()
export class Permission extends AuthorizationModel {
  @pk({ type: String }) id!: string;
  @unique() @required() @typeOf(String) @column() key!: string;
  @required() @typeOf(String) @option(PermissionCategoryOptions) @column() category!: PermissionCategory;
  @typeOf(String) @column() description?: string;
  @oneToMany(() => RolePermission, REL_RESTRICT, false) rolePermissions?: RolePermission[] | string[];
}

@table("roles")
@model()
export class Role extends AuthorizationModel {
  @pk({ type: String }) id!: string;
  @manyToOne(() => Tenant, REL_NULLIFY, false, undefined, "fk_roles_tenant")
  tenant?: Tenant | string;
  @required() @typeOf(String) @column() key!: string;
  @required() @typeOf(String) @column() name!: string;
  @typeOf(String) @column() description?: string;
  @typeOf(Object) @column() metadata?: Record<string, unknown>;
  @oneToMany(() => RolePermission, REL_RESTRICT, false) rolePermissions?: RolePermission[] | string[];
  @oneToMany(() => RoleAssignment, REL_RESTRICT, false) assignments?: RoleAssignment[] | string[];
  @createdAt() createdAt!: Date;
  @updatedAt() updatedAt!: Date;
}

@table("role_permissions")
@model()
export class RolePermission extends AuthorizationModel {
  @pk({ type: String }) id!: string;
  @manyToOne(() => Role, REL_CASCADE_DEPENDENT, false, undefined, "fk_role_permissions_role")
  @required()
  role!: Role | string;
  @manyToOne(() => Permission, REL_CASCADE_DEPENDENT, false, undefined, "fk_role_permissions_permission")
  @required()
  permission!: Permission | string;
  @createdAt() createdAt!: Date;
}

@table("role_assignments")
@model()
export class RoleAssignment extends AuthorizationModel {
  @pk({ type: String }) id!: string;
  @manyToOne(() => Tenant, REL_CASCADE_DEPENDENT, false, undefined, "fk_role_assignments_tenant")
  @required()
  tenant!: Tenant | string;
  @manyToOne(() => Principal, REL_CASCADE_DEPENDENT, false, undefined, "fk_role_assignments_principal")
  @required()
  principal!: Principal | string;
  @manyToOne(() => Role, REL_RESTRICT, false, undefined, "fk_role_assignments_role")
  @required()
  role!: Role | string;
  @required() @typeOf(String) @option(ScopeKindOptions) @column() scopeKind!: ScopeKind;
  @required() @typeOf(String) @column() scopeId!: string;
  @required() @typeOf(Boolean) @column() inheritDown!: boolean;
  @column() startsAt?: Date;
  @column() expiresAt?: Date;
  @typeOf(Object) @column() conditions?: Record<string, unknown>;
  @createdAt() createdAt!: Date;
  @updatedAt() updatedAt!: Date;
}

@table("inheritance_blocks")
@model()
export class InheritanceBlock extends AuthorizationModel {
  @pk({ type: String }) id!: string;
  @manyToOne(() => Tenant, REL_CASCADE_DEPENDENT, false, undefined, "fk_inheritance_blocks_tenant")
  @required()
  tenant!: Tenant | string;
  @manyToOne(() => OrgUnit, REL_CASCADE_DEPENDENT, false, undefined, "fk_inheritance_blocks_org_unit")
  @required()
  orgUnit!: OrgUnit | string;
  @manyToOne(() => OrgUnit, REL_NULLIFY, false, undefined, "fk_inheritance_blocks_blocked_ancestor")
  blockedFromAncestor?: OrgUnit | string;
  @required() @typeOf(String) @option(PermissionCategoryOptions) @column() permissionCategory!: PermissionCategory;
  @typeOf(String) @column() reason?: string;
  @createdAt() createdAt!: Date;
  @updatedAt() updatedAt!: Date;
}

@table("protected_resources")
@model()
export class ProtectedResource extends AuthorizationModel {
  @pk({ type: String }) id!: string;
  @manyToOne(() => Tenant, REL_RESTRICT, false, undefined, "fk_protected_resources_tenant")
  @required()
  tenant!: Tenant | string;
  @manyToOne(() => OrgUnit, REL_RESTRICT, false, undefined, "fk_protected_resources_org_unit")
  @required()
  orgUnit!: OrgUnit | string;
  @required() @typeOf(String) @column() resourceType!: string;
  @required() @typeOf(String) @column() resourceId!: string;
  @required() @typeOf(String) @option(ResourceVisibilityOptions) @column() visibility!: ResourceVisibility;
  @manyToOne(() => Principal, REL_NULLIFY, false, undefined, "fk_protected_resources_owner")
  owner?: Principal | string;
  @typeOf(String) @column() sensitivity?: string;
  @typeOf(Object) @column() metadata?: Record<string, unknown>;
  @oneToMany(() => ResourceGrant, REL_RESTRICT, false) grants?: ResourceGrant[] | string[];
  @createdAt() createdAt!: Date;
  @updatedAt() updatedAt!: Date;
}

@table("resource_grants")
@model()
export class ResourceGrant extends AuthorizationModel {
  @pk({ type: String }) id!: string;
  @manyToOne(() => Tenant, REL_CASCADE_DEPENDENT, false, undefined, "fk_resource_grants_tenant")
  @required()
  tenant!: Tenant | string;
  @manyToOne(() => ProtectedResource, REL_CASCADE_DEPENDENT, false, undefined, "fk_resource_grants_resource")
  @required()
  resource!: ProtectedResource | string;
  @manyToOne(() => Principal, REL_CASCADE_DEPENDENT, false, undefined, "fk_resource_grants_principal")
  @required()
  principal!: Principal | string;
  @required() @typeOf(String) @column() permissionKey!: string;
  @column() startsAt?: Date;
  @column() expiresAt?: Date;
  @typeOf(Object) @column() conditions?: Record<string, unknown>;
  @manyToOne(() => Principal, REL_RESTRICT, false, undefined, "fk_resource_grants_created_by")
  createdBy?: Principal | string;
  @createdAt() createdAt!: Date;
  @updatedAt() updatedAt!: Date;
}

@table("effective_permissions")
@model()
export class EffectivePermission extends AuthorizationModel {
  @pk({ type: String }) id!: string;
  @manyToOne(() => Tenant, REL_CASCADE_DEPENDENT, false, undefined, "fk_effective_permissions_tenant")
  @required()
  tenant!: Tenant | string;
  @manyToOne(() => Principal, REL_CASCADE_DEPENDENT, false, undefined, "fk_effective_permissions_principal")
  @required()
  principal!: Principal | string;
  @required() @typeOf(String) @column() permissionKey!: string;
  @required() @typeOf(String) @option(ScopeKindOptions) @column() scopeKind!: ScopeKind;
  @required() @typeOf(String) @column() scopeId!: string;
  @required() @typeOf(String) @column() sourceKind!: string;
  @required() @typeOf(String) @column() sourceId!: string;
  @column() startsAt?: Date;
  @column() expiresAt?: Date;
  @createdAt() createdAt!: Date;
}

@table("storage_bindings")
@model()
export class StorageBinding extends AuthorizationModel {
  @pk({ type: String }) id!: string;
  @manyToOne(() => Tenant, REL_CASCADE_DEPENDENT, false, undefined, "fk_storage_bindings_tenant")
  @required()
  tenant!: Tenant | string;
  @required() @typeOf(String) @option(StorageKindOptions) @column() storageKind!: StorageKind;
  @required() @typeOf(String) @option(StorageBindingKindOptions) @column() bindingKind!: StorageBindingKind;
  @required() @typeOf(String) @column() bindingKey!: string;
  @required() @typeOf(String) @column() region!: string;
  @typeOf(Object) @column() config?: Record<string, unknown>;
  @createdAt() createdAt!: Date;
  @updatedAt() updatedAt!: Date;
}
