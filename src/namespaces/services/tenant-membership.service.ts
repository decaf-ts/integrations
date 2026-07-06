import { BaseModelService, relationMatch, sameTenant } from "../utils";
import { MembershipStatus } from "../types";
import { TenantMembership } from "../models/tenant-membership.model";

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
    return this.create(
      {
        tenant: tenantId,
        user: userId,
        status,
      },
      ...args
    );
  }

  async setStatus(membershipId: string, status: MembershipStatus, ...args: any[]): Promise<TenantMembership> {
    return this.updateOne(membershipId, { status }, ...args);
  }

  async listUserTenants(userId: string, ...args: any[]): Promise<TenantMembership[]> {
    return (await this.listAll(...args)).filter((membership) => relationMatch(membership.user, userId));
  }

  async listTenantUsers(tenantId: string, ...args: any[]): Promise<TenantMembership[]> {
    return (await this.listAll(...args)).filter((membership) => sameTenant(membership.tenant, tenantId));
  }

  async removeUserFromTenant(membershipId: string, ...args: any[]): Promise<void> {
    await this.deleteById(membershipId, ...args);
  }
}
