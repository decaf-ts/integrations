import { BaseModelService, lowerSlug, relationId, relationMatch, sameTenant } from "../utils";
import type { CreateOrgUnitInput } from "../types";
import { OrgUnit } from "../models/org-unit.model";
import { OrgUnitProfileService } from "./org-unit-profile.service";
import { OrgUnitClosureService } from "./org-unit-closure.service";
import { transactional } from "../utils";

async function deleteRowsById(
  service: BaseModelService<any>,
  rows: Array<{ id: string }>,
  ...args: any[]
): Promise<void> {
  for (const row of rows) {
    await service.deleteById(row.id, ...args);
  }
}

export class OrgUnitService extends BaseModelService<OrgUnit> {
  constructor() {
    super(OrgUnit);
  }

  private orgUnitPath(parentPath: string | undefined, name: string): string {
    const segment = lowerSlug(name);
    return parentPath ? `${parentPath.replace(/\/+$/, "")}/${segment}` : `/${segment}`;
  }

  private async createProfileIfNeeded(
    orgUnitId: string,
    profileKey: string | undefined,
    profileMetadata: Record<string, unknown> | undefined,
    ...args: any[]
  ): Promise<void> {
    if (!profileKey) return;
    await new OrgUnitProfileService().createProfile(orgUnitId, profileKey, profileMetadata, ...args);
  }

  @transactional()
  async createRoot(
    tenantId: string,
    name: string,
    metadata?: Record<string, unknown>,
    profileKey?: string,
    profileMetadata?: Record<string, unknown>,
    ...args: any[]
  ): Promise<OrgUnit> {
    const orgUnit = await this.create(
      {
        tenant: tenantId,
        name,
        path: this.orgUnitPath(undefined, name),
        metadata,
      },
      ...args
    );
    await this.createProfileIfNeeded(orgUnit.id, profileKey, profileMetadata, ...args);
    await new OrgUnitClosureService().createSelfLink(tenantId, orgUnit.id, ...args);
    return orgUnit;
  }

  @transactional()
  async createChild(input: CreateOrgUnitInput, ...args: any[]): Promise<OrgUnit> {
    const parent = input.parentOrgUnitId ? await this.getById(input.parentOrgUnitId, ...args) : undefined;
    const orgUnit = await this.create(
      {
        tenant: input.tenantId,
        parent: parent?.id ?? input.parentOrgUnitId,
        name: input.name,
        path: this.orgUnitPath(parent?.path, input.name),
        metadata: input.metadata,
      },
      ...args
    );
    await this.createProfileIfNeeded(orgUnit.id, input.profileKey, input.profileMetadata, ...args);
    const closureService = new OrgUnitClosureService();
    await closureService.createSelfLink(input.tenantId, orgUnit.id, ...args);
    if (input.parentOrgUnitId) {
      await closureService.insertAncestorLinksForNewChild(
        input.tenantId,
        input.parentOrgUnitId,
        orgUnit.id,
        ...args
      );
    }
    return orgUnit;
  }

  async listChildren(parentOrgUnitId: string, ...args: any[]): Promise<OrgUnit[]> {
    return (await this.listAll(...args)).filter((orgUnit) => relationMatch(orgUnit.parent, parentOrgUnitId));
  }

  async listTenantOrgUnits(tenantId: string, ...args: any[]): Promise<OrgUnit[]> {
    return (await this.listAll(...args)).filter((orgUnit) => sameTenant(orgUnit.tenant, tenantId));
  }

  async listDescendantOrgUnits(
    tenantId: string,
    orgUnitId: string,
    includeSelf = false,
    ...args: any[]
  ): Promise<OrgUnit[]> {
    const descendants = await new OrgUnitClosureService().listDescendants(tenantId, orgUnitId, ...args);
    const ids = new Set(descendants.map((row) => relationId(row.descendant)));
    if (includeSelf) ids.add(orgUnitId);
    return (await this.listTenantOrgUnits(tenantId, ...args)).filter((orgUnit) => ids.has(orgUnit.id));
  }

  async listAncestorOrgUnits(
    tenantId: string,
    orgUnitId: string,
    includeSelf = false,
    ...args: any[]
  ): Promise<OrgUnit[]> {
    const ancestors = await new OrgUnitClosureService().listAncestors(tenantId, orgUnitId, ...args);
    const ids = new Set(ancestors.map((row) => relationId(row.ancestor)));
    if (includeSelf) ids.add(orgUnitId);
    return (await this.listTenantOrgUnits(tenantId, ...args)).filter((orgUnit) => ids.has(orgUnit.id));
  }

  async renameOrgUnit(orgUnitId: string, name: string, ...args: any[]): Promise<OrgUnit> {
    const existing = await this.getById(orgUnitId, ...args);
    return this.updateOne(
      orgUnitId,
      { name, path: this.orgUnitPath(existing.path.includes("/") ? existing.path.replace(/\/[^/]+$/, "") : undefined, name) },
      ...args
    );
  }

  @transactional()
  async moveOrgUnit(
    tenantId: string,
    orgUnitId: string,
    newParentOrgUnitId: string,
    ...args: any[]
  ): Promise<OrgUnit> {
    const newParent = await this.getById(newParentOrgUnitId, ...args);
    const existing = await this.getById(orgUnitId, ...args);
    const updated = await this.updateOne(
      orgUnitId,
      {
        parent: newParent.id,
        path: this.orgUnitPath(newParent.path, existing.name),
      },
      ...args
    );
    await this.rebuildTenantClosure(tenantId, ...args);
    return updated;
  }

  @transactional()
  async rebuildTenantClosure(tenantId: string, ...args: any[]): Promise<void> {
    const closureService = new OrgUnitClosureService();
    const existingLinks = await closureService.listAll(...args);
    await deleteRowsById(
      closureService,
      existingLinks.filter((row) => sameTenant(row.tenant, tenantId)),
      ...args
    );

    const orgUnits = (await this.listTenantOrgUnits(tenantId, ...args)).sort((left, right) => {
      const leftDepth = left.path.split("/").filter(Boolean).length;
      const rightDepth = right.path.split("/").filter(Boolean).length;
      return leftDepth - rightDepth;
    });

    for (const orgUnit of orgUnits) {
      await closureService.createSelfLink(tenantId, orgUnit.id, ...args);
      if (orgUnit.parent) {
        await closureService.insertAncestorLinksForNewChild(
          tenantId,
          relationId(orgUnit.parent),
          orgUnit.id,
          ...args
        );
      }
    }
  }

  @transactional()
  async deleteOrgUnitTree(tenantId: string, orgUnitId: string, ...args: any[]): Promise<void> {
    const closureService = new OrgUnitClosureService();
    const descendants = await this.listDescendantOrgUnits(tenantId, orgUnitId, true, ...args);
    const descendantIds = new Set(descendants.map((orgUnit) => orgUnit.id));
    const orgUnits = (await this.listTenantOrgUnits(tenantId, ...args)).filter((orgUnit) =>
      descendantIds.has(orgUnit.id)
    );
    await deleteRowsById(this, orgUnits, ...args);
    await closureService.deleteLinksForSubtree(tenantId, orgUnitId, ...args);
  }
}
