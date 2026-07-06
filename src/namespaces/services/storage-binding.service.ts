import { BaseModelService, relationId } from "../utils";
import { CreateStorageBindingInput, StorageBindingKind, StorageKind } from "../types";
import { StorageBinding } from "../models/storage-binding.model";

export class StorageBindingService extends BaseModelService<StorageBinding> {
  constructor() {
    super(StorageBinding);
  }

  async createBinding(input: CreateStorageBindingInput, ...args: any[]): Promise<StorageBinding> {
    return this.create(
      {
        tenant: input.tenantId,
        storageKind: input.storageKind,
        bindingKind: input.bindingKind,
        bindingKey: input.bindingKey,
        region: input.region,
        config: input.config,
      },
      ...args
    );
  }

  async listTenantBindings(tenantId: string, ...args: any[]): Promise<StorageBinding[]> {
    return (await this.listAll(...args)).filter((binding) => relationId(binding.tenant) === tenantId);
  }

  async getBinding(tenantId: string, storageKind: StorageKind, ...args: any[]): Promise<StorageBinding | undefined> {
    return (await this.listTenantBindings(tenantId, ...args)).find((binding) => binding.storageKind === storageKind);
  }

  async setBindingConfig(
    bindingId: string,
    config: Record<string, unknown> | undefined,
    ...args: any[]
  ): Promise<StorageBinding> {
    return this.updateOne(bindingId, { config }, ...args);
  }

  async promoteToDedicated(
    bindingId: string,
    bindingKey: string,
    region: string,
    config?: Record<string, unknown>,
    ...args: any[]
  ): Promise<StorageBinding> {
    return this.updateOne(bindingId, { bindingKind: StorageBindingKind.Dedicated, bindingKey, region, config }, ...args);
  }

  async setShared(
    bindingId: string,
    bindingKey: string,
    region: string,
    config?: Record<string, unknown>,
    ...args: any[]
  ): Promise<StorageBinding> {
    return this.updateOne(bindingId, { bindingKind: StorageBindingKind.Shared, bindingKey, region, config }, ...args);
  }
}
