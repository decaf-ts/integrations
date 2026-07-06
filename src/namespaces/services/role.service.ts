import { BaseModelService, sameTenant } from "../utils";
import { CreateRoleInput } from "../types";
import { Role } from "../models/role.model";

export class RoleService extends BaseModelService<Role> {
  constructor() {
    super(Role);
  }

  async createRole(input: CreateRoleInput, ...args: any[]): Promise<Role> {
    return this.create(
      {
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
    const role = (await this.listAll(...args)).find((candidate) => !candidate.tenant && candidate.key === key);
    if (!role) {
      throw new Error(`Role "${key}" not found`);
    }
    return role;
  }

  async getTenantRoleByKey(tenantId: string, key: string, ...args: any[]): Promise<Role> {
    const role = (await this.listAll(...args)).find(
      (candidate) => sameTenant(candidate.tenant, tenantId) && candidate.key === key
    );
    if (!role) {
      throw new Error(`Role "${key}" not found for tenant ${tenantId}`);
    }
    return role;
  }

  async renameRole(roleId: string, name: string, ...args: any[]): Promise<Role> {
    return this.updateOne(roleId, { name }, ...args);
  }

  async updateRoleMetadata(
    roleId: string,
    metadata: Record<string, unknown> | undefined,
    ...args: any[]
  ): Promise<Role> {
    return this.updateOne(roleId, { metadata }, ...args);
  }

  async listTenantRoles(tenantId: string, includeSystem = false, ...args: any[]): Promise<Role[]> {
    return (await this.listAll(...args)).filter((role) =>
      includeSystem ? !role.tenant || sameTenant(role.tenant, tenantId) : sameTenant(role.tenant, tenantId)
    );
  }
}
