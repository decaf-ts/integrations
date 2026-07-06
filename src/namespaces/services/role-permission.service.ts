import { BaseModelService, relationMatch } from "../utils";
import { RolePermission } from "../models/role-permission.model";
import { PermissionService } from "./permission.service";
import { RoleService } from "./role.service";

async function deleteRowsById(
  service: BaseModelService<any>,
  rows: Array<{ id: string }>,
  ...args: any[]
): Promise<void> {
  for (const row of rows) {
    await service.deleteById(row.id, ...args);
  }
}

export class RolePermissionService extends BaseModelService<RolePermission> {
  constructor() {
    super(RolePermission);
  }

  async addPermissionToRole(roleId: string, permissionId: string, ...args: any[]): Promise<RolePermission> {
    return this.create(
      {
        role: roleId,
        permission: permissionId,
      },
      ...args
    );
  }

  async addPermissionKeyToRole(roleId: string, permissionKey: string, ...args: any[]): Promise<RolePermission> {
    const permission = await new PermissionService().getByKey(permissionKey, ...args);
    return this.addPermissionToRole(roleId, permission.id, ...args);
  }

  async removePermissionFromRole(rolePermissionId: string, ...args: any[]): Promise<void> {
    await this.deleteById(rolePermissionId, ...args);
  }

  async listRolePermissions(roleId: string, ...args: any[]): Promise<RolePermission[]> {
    return (await this.listAll(...args)).filter((rolePermission) => relationMatch(rolePermission.role, roleId));
  }

  async listPermissionRoles(permissionId: string, ...args: any[]): Promise<RolePermission[]> {
    return (await this.listAll(...args)).filter((rolePermission) => relationMatch(rolePermission.permission, permissionId));
  }

  async replaceRolePermissions(roleId: string, permissionIds: string[], ...args: any[]): Promise<RolePermission[]> {
    const existing = await this.listRolePermissions(roleId, ...args);
    await deleteRowsById(this, existing, ...args);
    return Promise.all(permissionIds.map((permissionId) => this.addPermissionToRole(roleId, permissionId, ...args)));
  }

  async createRoleWithPermissions(
    input: import("../types").CreateRoleInput,
    permissionKeys: string[],
    ...args: any[]
  ): Promise<import("../models/role.model").Role> {
    const role = await new RoleService().createRole(input, ...args);
    for (const permissionKey of permissionKeys) {
      await this.addPermissionKeyToRole(role.id, permissionKey, ...args);
    }
    return role;
  }
}
