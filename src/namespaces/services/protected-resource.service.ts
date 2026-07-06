import { BaseModelService, relationMatch, sameTenant } from "../utils";
import { RegisterResourceInput, ResourceVisibility } from "../types";
import { ProtectedResource } from "../models/protected-resource.model";

export class ProtectedResourceService extends BaseModelService<ProtectedResource> {
  constructor() {
    super(ProtectedResource);
  }

  async registerResource(input: RegisterResourceInput, ...args: any[]): Promise<ProtectedResource> {
    return this.create(
      {
        tenant: input.tenantId,
        orgUnit: input.orgUnitId,
        resourceType: input.resourceType,
        resourceId: input.resourceId,
        visibility: input.visibility,
        owner: input.ownerPrincipalId,
        sensitivity: input.sensitivity,
        metadata: input.metadata,
      },
      ...args
    );
  }

  async getByDomainResource(tenantId: string, resourceType: string, resourceId: string, ...args: any[]): Promise<ProtectedResource | undefined> {
    return (await this.listAll(...args)).find(
      (resource) => sameTenant(resource.tenant, tenantId) && resource.resourceType === resourceType && resource.resourceId === resourceId
    );
  }

  async moveResourceToOrgUnit(protectedResourceId: string, orgUnitId: string, ...args: any[]): Promise<ProtectedResource> {
    return this.updateOne(protectedResourceId, { orgUnit: orgUnitId }, ...args);
  }

  async setVisibility(protectedResourceId: string, visibility: ResourceVisibility, ...args: any[]): Promise<ProtectedResource> {
    return this.updateOne(protectedResourceId, { visibility }, ...args);
  }

  async transferOwnership(protectedResourceId: string, ownerPrincipalId: string | undefined, ...args: any[]): Promise<ProtectedResource> {
    return this.updateOne(protectedResourceId, { owner: ownerPrincipalId }, ...args);
  }

  async listOrgUnitResources(orgUnitId: string, ...args: any[]): Promise<ProtectedResource[]> {
    return (await this.listAll(...args)).filter((resource) => relationMatch(resource.orgUnit, orgUnitId));
  }

  async listTenantResources(tenantId: string, ...args: any[]): Promise<ProtectedResource[]> {
    return (await this.listAll(...args)).filter((resource) => sameTenant(resource.tenant, tenantId));
  }
}
