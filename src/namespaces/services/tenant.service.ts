import { BaseModelService } from "../utils";
import { IsolationTier, CreateTenantInput } from "../types";
import { Tenant } from "../models/tenant.model";

export class TenantService extends BaseModelService<Tenant> {
  constructor() {
    super(Tenant);
  }

  async createTenant(input: CreateTenantInput, ...args: any[]): Promise<Tenant> {
    return this.create(
      {
        slug: input.slug,
        name: input.name,
        isolationTier: input.isolationTier ?? IsolationTier.Pooled,
      },
      ...args
    );
  }

  async getBySlug(slug: string, ...args: any[]): Promise<Tenant> {
    return this.findOneBy("slug", slug as never, ...args);
  }

  async renameTenant(tenantId: string, name: string, ...args: any[]): Promise<Tenant> {
    return this.updateOne(tenantId, { name }, ...args);
  }

  async changeSlug(tenantId: string, slug: string, ...args: any[]): Promise<Tenant> {
    return this.updateOne(tenantId, { slug }, ...args);
  }

  async setIsolationTier(
    tenantId: string,
    isolationTier: IsolationTier,
    ...args: any[]
  ): Promise<Tenant> {
    return this.updateOne(tenantId, { isolationTier }, ...args);
  }

  async deleteTenantControlled(tenantId: string, ...args: any[]): Promise<void> {
    await this.deleteById(tenantId, ...args);
  }
}
