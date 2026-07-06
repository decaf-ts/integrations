import { BaseModelService, relationId, relationMatch } from "../utils";
import { GroupMembership } from "../models/group-membership.model";
import { PrincipalService } from "./principal.service";

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
    return this.create(
      {
        tenant: tenantId,
        group: groupId,
        principal: principalId,
        metadata,
      },
      ...args
    );
  }

  async listGroupMembers(groupId: string, ...args: any[]): Promise<GroupMembership[]> {
    return (await this.listAll(...args)).filter((membership) => relationMatch(membership.group, groupId));
  }

  async listPrincipalGroups(principalId: string, ...args: any[]): Promise<GroupMembership[]> {
    return (await this.listAll(...args)).filter((membership) => relationMatch(membership.principal, principalId));
  }

  async removePrincipalFromGroup(membershipId: string, ...args: any[]): Promise<void> {
    await this.deleteById(membershipId, ...args);
  }

  async resolveGroupPrincipalIdsForPrincipal(principalId: string, ...args: any[]): Promise<string[]> {
    const principalService = new PrincipalService();
    const memberships = await this.listPrincipalGroups(principalId, ...args);
    const principals = await Promise.all(
      memberships.map(async (membership) => {
        const tenantId = relationId(membership.tenant);
        const groupId = relationId(membership.group);
        const principal = await principalService.getGroupPrincipal(tenantId, groupId, ...args);
        return principal.id;
      })
    );
    return principals;
  }
}
