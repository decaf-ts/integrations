import { Cascade, ModelService, Repository } from "@decaf-ts/core";
import { Model } from "@decaf-ts/decorator-validation";
import {
  AccessContext,
  ArangoAuthContext,
  EffectivePermissionSnapshot,
  GrantSnapshot,
  QdrantAuthFilter,
  ScopeKind,
} from "./types";

export const REL_RESTRICT = {
  update: Cascade.NONE,
  delete: Cascade.NONE,
  nullable: false,
} as const;

export const REL_NULLIFY = {
  update: Cascade.NONE,
  delete: Cascade.NONE,
  nullable: true,
} as const;

export const REL_CASCADE_DEPENDENT = {
  update: Cascade.CASCADE,
  delete: Cascade.CASCADE,
  nullable: false,
} as const;

export const REL_CASCADE_INSERT_UPDATE = {
  update: Cascade.CASCADE,
  delete: Cascade.NONE,
  nullable: false,
} as const;

export function buildArangoContext(options: {
  tenantId: string;
  principalId: string;
  permissionKey: string;
  allowedOrgUnitIds: string[];
  allowedResourceIds: string[];
}): ArangoAuthContext {
  return {
    tenantId: options.tenantId,
    principalId: options.principalId,
    permissionKey: options.permissionKey,
    allowedOrgUnitIds: [...options.allowedOrgUnitIds],
    allowedResourceIds: [...options.allowedResourceIds],
  };
}

export function buildQdrantFilter(options: {
  tenantId: string;
  principalId: string;
  permissionKey: string;
  allowedOrgUnitIds: string[];
  allowedResourceIds: string[];
}): QdrantAuthFilter {
  return {
    must: [
      {
        key: "tenant_id",
        match: { value: options.tenantId },
      },
      {
        should: [
          { key: "org_unit_id", match: { any: options.allowedOrgUnitIds } },
          {
            key: "protected_resource_id",
            match: { any: options.allowedResourceIds },
          },
          { key: "owner_principal_id", match: { value: options.principalId } },
        ],
      },
    ],
  };
}

function scopeKey(scopeKind: ScopeKind, scopeId: string): string {
  return `${scopeKind}:${scopeId}`;
}

export function nowIso(): Date {
  return new Date();
}

export function asArray<T>(value: T[] | undefined): T[] {
  return value ?? [];
}

export function sameTenant(rowTenant: unknown, tenantId: string): boolean {
  return relationId(rowTenant as { id: string } | string) === tenantId;
}

export function relationMatch(
  value: unknown,
  target: string | undefined
): boolean {
  return target
    ? relationId(value as { id: string } | string) === target
    : false;
}

export function lowerSlug(value: string): string {
  return (
    value
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "item"
  );
}

export function isTimeValid(
  at: Date | undefined,
  startsAt?: Date,
  expiresAt?: Date
): boolean {
  const instant = at ?? new Date();
  if (startsAt && instant < startsAt) return false;
  if (expiresAt && instant > expiresAt) return false;
  return true;
}

export function buildAccessContext(options: {
  tenantId: string;
  principalId: string;
  permissions: EffectivePermissionSnapshot[];
  grants: GrantSnapshot[];
}): AccessContext {
  const permissionsByScope: Record<string, string[]> = {};
  const allowedOrgUnitIdsByPermission: Record<string, string[]> = {};

  for (const permission of options.permissions) {
    const key = scopeKey(permission.scopeKind, permission.scopeId);
    permissionsByScope[key] = permissionsByScope[key] ?? [];
    permissionsByScope[key].push(permission.permissionKey);
    if (permission.scopeKind === ScopeKind.OrgUnit) {
      allowedOrgUnitIdsByPermission[permission.permissionKey] =
        allowedOrgUnitIdsByPermission[permission.permissionKey] ?? [];
      allowedOrgUnitIdsByPermission[permission.permissionKey].push(
        permission.scopeId
      );
    }
  }

  return {
    tenantId: options.tenantId,
    principalId: options.principalId,
    permissionsByScope,
    allowedOrgUnitIdsByPermission,
    resourceGrants: options.grants.map((grant) => ({
      resourceId: grant.resourceId,
      permissionKey: grant.permissionKey,
    })),
  };
}

export abstract class BaseModelService<
  M extends Model<boolean> & { id: string },
> extends ModelService<M, Repository<M, any>> {
  protected constructor(clazz: new () => M) {
    super(clazz);
  }

  protected newModel<T>(clazz: new () => T, data: Partial<T>): T {
    return Object.assign(new clazz() as object, data as object) as T;
  }

  async create(data: Partial<M>, ...args: any[]): Promise<M> {
    return this.repo.create(Object.assign({} as M, data as object), ...args);
  }

  async createOne(data: Partial<M>, ...args: any[]): Promise<M> {
    return this.create(data, ...args);
  }

  async getById(id: string, ...args: any[]): Promise<M> {
    return this.repo.read(id, ...args);
  }

  async updateOne(id: string, patch: Partial<M>, ...args: any[]): Promise<M> {
    const existing = await this.repo.read(id, ...args);
    return this.repo.update(Object.assign(existing, patch), ...args);
  }

  async deleteById(id: string, ...args: any[]): Promise<void> {
    await this.repo.delete(id, ...args);
  }

  async findOneBy<K extends keyof M & string>(
    key: K,
    value: M[K],
    ...args: any[]
  ): Promise<M> {
    return this.repo.findOneBy(key, value, ...args);
  }

  async findManyBy<K extends keyof M & string>(
    key: K,
    value: M[K],
    ...args: any[]
  ): Promise<M[]> {
    return this.repo
      .select()
      .where({ [key]: value } as any)
      .execute(...args);
  }

  async listAll(...args: any[]): Promise<M[]> {
    return this.repo.select().execute(...args);
  }
}

export function id(): string {
  return crypto.randomUUID();
}

export function relationId(value: string | { id: string }): string {
  return typeof value === "string" ? value : value.id;
}

export { AuthorizationError, transactional } from "@decaf-ts/core";
