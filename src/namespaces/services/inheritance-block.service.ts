import { BaseModelService, relationMatch, sameTenant } from "../utils";
import { PermissionCategory } from "../types";
import { InheritanceBlock } from "../models/inheritance-block.model";

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
    return this.create(
      {
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
