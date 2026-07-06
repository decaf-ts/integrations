import { BaseModelService, relationMatch, sameTenant } from "../utils";
import { GrantResourceInput } from "../types";
import { ResourceGrant } from "../models/resource-grant.model";

export class ResourceGrantService extends BaseModelService<ResourceGrant> {
  constructor() {
    super(ResourceGrant);
  }

  async grantResource(input: GrantResourceInput, ...args: any[]): Promise<ResourceGrant> {
    return this.create(
      {
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

  async listResourceGrants(protectedResourceId: string, ...args: any[]): Promise<ResourceGrant[]> {
    return (await this.listAll(...args)).filter((grant) => relationMatch(grant.resource, protectedResourceId));
  }

  async listPrincipalGrants(tenantId: string, principalId: string, ...args: any[]): Promise<ResourceGrant[]> {
    return (await this.listAll(...args)).filter(
      (grant) => sameTenant(grant.tenant, tenantId) && relationMatch(grant.principal, principalId)
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
    return (await this.listPrincipalGrants(tenantId, principalId, ...args)).some(
      (grant) =>
        relationMatch(grant.resource, protectedResourceId) &&
        grant.permissionKey === permissionKey &&
        (!grant.startsAt || !at || grant.startsAt <= at) &&
        (!grant.expiresAt || !at || grant.expiresAt >= at)
    );
  }

  async deleteAllForResource(protectedResourceId: string, ...args: any[]): Promise<void> {
    for (const row of await this.listResourceGrants(protectedResourceId, ...args)) {
      await this.deleteById(row.id, ...args);
    }
  }
}
