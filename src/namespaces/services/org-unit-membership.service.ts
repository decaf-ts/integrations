import { BaseModelService, relationMatch } from "../utils";
import { MembershipStatus } from "../types";
import { OrgUnitMembership } from "../models/org-unit-membership.model";

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
    return this.create(
      {
        tenant: tenantId,
        orgUnit: orgUnitId,
        user: userId,
        status,
      },
      ...args
    );
  }

  async setStatus(membershipId: string, status: MembershipStatus, ...args: any[]): Promise<OrgUnitMembership> {
    return this.updateOne(membershipId, { status }, ...args);
  }

  async listUserOrgUnits(userId: string, ...args: any[]): Promise<OrgUnitMembership[]> {
    return (await this.listAll(...args)).filter((membership) => relationMatch(membership.user, userId));
  }

  async listOrgUnitUsers(orgUnitId: string, ...args: any[]): Promise<OrgUnitMembership[]> {
    return (await this.listAll(...args)).filter((membership) => relationMatch(membership.orgUnit, orgUnitId));
  }

  async removeUserFromOrgUnit(membershipId: string, ...args: any[]): Promise<void> {
    await this.deleteById(membershipId, ...args);
  }
}
