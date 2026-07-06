import { BaseModelService, sameTenant } from "../utils";
import { Group } from "../models/group.model";

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
    return this.create(
      {
        tenant: tenantId,
        orgUnit: orgUnitId,
        name,
        metadata,
      },
      ...args
    );
  }

  async renameGroup(groupId: string, name: string, ...args: any[]): Promise<Group> {
    return this.updateOne(groupId, { name }, ...args);
  }

  async moveGroupToOrgUnit(groupId: string, orgUnitId: string | undefined, ...args: any[]): Promise<Group> {
    return this.updateOne(groupId, { orgUnit: orgUnitId }, ...args);
  }

  async listTenantGroups(tenantId: string, ...args: any[]): Promise<Group[]> {
    return (await this.listAll(...args)).filter((group) => sameTenant(group.tenant, tenantId));
  }
}
