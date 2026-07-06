import { BaseModelService, id, relationId, sameTenant } from "../utils";
import { TenantProfile } from "../models/tenant-profile.model";

export class TenantProfileService extends BaseModelService<TenantProfile> {
  constructor() {
    super(TenantProfile);
  }

  async createProfile(
    tenantId: string,
    profileKey: string,
    metadata?: Record<string, unknown>,
    ...args: any[]
  ): Promise<TenantProfile> {
    return this.create(
      {
        tenant: tenantId,
        profileKey,
        metadata,
      },
      ...args
    );
  }

  async listForTenant(tenantId: string, ...args: any[]): Promise<TenantProfile[]> {
    return (await this.listAll(...args)).filter((profile) => sameTenant(profile.tenant, tenantId));
  }

  async deleteForTenant(tenantId: string, ...args: any[]): Promise<void> {
    for (const row of await this.listForTenant(tenantId, ...args)) {
      await this.deleteById(row.id, ...args);
    }
  }
}
