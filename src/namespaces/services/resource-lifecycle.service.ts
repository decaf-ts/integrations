import { ProtectedResourceService } from "./protected-resource.service";
import { ResourceGrantService } from "./resource-grant.service";
import { relationId } from "../utils";
import { ResourceVisibility } from "../types";

export class ResourceLifecycleService {
  async unregisterResource(protectedResourceId: string, ...args: any[]): Promise<void> {
    await new ResourceGrantService().deleteAllForResource(protectedResourceId, ...args);
    await new ProtectedResourceService().deleteById(protectedResourceId, ...args);
  }

  async resolveResourceScope(
    protectedResourceId: string,
    ...args: any[]
  ): Promise<{
    tenantId: string;
    orgUnitId: string;
    visibility: ResourceVisibility;
    ownerPrincipalId?: string;
  }> {
    const resource = await new ProtectedResourceService().getById(protectedResourceId, ...args);
    return {
      tenantId: relationId(resource.tenant),
      orgUnitId: relationId(resource.orgUnit),
      visibility: resource.visibility,
      ownerPrincipalId: resource.owner ? relationId(resource.owner) : undefined,
    };
  }
}
