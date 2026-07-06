import { BaseModelService } from "../utils";
import { PermissionCategory, CreatePermissionInput } from "../types";
import { Permission } from "../models/permission.model";

export class PermissionService extends BaseModelService<Permission> {
  constructor() {
    super(Permission);
  }

  async createPermission(input: CreatePermissionInput, ...args: any[]): Promise<Permission> {
    return this.create(
      {
        key: input.key,
        category: input.category,
        description: input.description,
      },
      ...args
    );
  }

  async getByKey(key: string, ...args: any[]): Promise<Permission> {
    return (await this.listAll(...args)).find((permission) => permission.key === key) as Permission;
  }

  async listByCategory(category: PermissionCategory, ...args: any[]): Promise<Permission[]> {
    return (await this.listAll(...args)).filter((permission) => permission.category === category);
  }

  async updateDescription(permissionId: string, description: string | undefined, ...args: any[]): Promise<Permission> {
    return this.updateOne(permissionId, { description }, ...args);
  }
}
