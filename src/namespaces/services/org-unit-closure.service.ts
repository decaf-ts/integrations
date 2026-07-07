import {
  BaseModelService,
  relationId,
  relationMatch,
  sameTenant,
} from "../utils";
import { OrgUnitClosure } from "../models/org-unit-closure.model";

export class OrgUnitClosureService extends BaseModelService<OrgUnitClosure> {
  constructor() {
    super(OrgUnitClosure);
  }

  async listAncestors(
    tenantId: string,
    orgUnitId: string,
    ...args: any[]
  ): Promise<OrgUnitClosure[]> {
    return (await this.listAll(...args))
      .filter(
        (row) =>
          sameTenant(row.tenant, tenantId) &&
          relationMatch(row.descendant, orgUnitId)
      )
      .sort((left, right) => left.depth - right.depth);
  }

  async listDescendants(
    tenantId: string,
    orgUnitId: string,
    ...args: any[]
  ): Promise<OrgUnitClosure[]> {
    return (await this.listAll(...args))
      .filter(
        (row) =>
          sameTenant(row.tenant, tenantId) &&
          relationMatch(row.ancestor, orgUnitId)
      )
      .sort((left, right) => left.depth - right.depth);
  }

  async isAncestorOf(
    tenantId: string,
    ancestorOrgUnitId: string,
    descendantOrgUnitId: string,
    ...args: any[]
  ): Promise<boolean> {
    return (
      await this.listAncestors(tenantId, descendantOrgUnitId, ...args)
    ).some((row) => relationMatch(row.ancestor, ancestorOrgUnitId));
  }

  async createSelfLink(
    tenantId: string,
    orgUnitId: string,
    ...args: any[]
  ): Promise<OrgUnitClosure> {
    return this.create(
      {
        tenant: tenantId,
        ancestor: orgUnitId,
        descendant: orgUnitId,
        depth: 0,
      },
      ...args
    );
  }

  async insertAncestorLinksForNewChild(
    tenantId: string,
    parentOrgUnitId: string,
    childOrgUnitId: string,
    ...args: any[]
  ): Promise<void> {
    const ancestorLinks = await this.listAncestors(
      tenantId,
      parentOrgUnitId,
      ...args
    );
    for (const link of ancestorLinks) {
      await this.create(
        {
          tenant: tenantId,
          ancestor: link.ancestor,
          descendant: childOrgUnitId,
          depth: link.depth + 1,
        },
        ...args
      );
    }
  }

  async deleteLinksForSubtree(
    tenantId: string,
    orgUnitId: string,
    ...args: any[]
  ): Promise<void> {
    const subtree = await this.listDescendants(tenantId, orgUnitId, ...args);
    const descendantIds = new Set([
      orgUnitId,
      ...subtree.map((row) => relationId(row.descendant)),
    ]);
    const ancestorIds = new Set([
      orgUnitId,
      ...subtree.map((row) => relationId(row.ancestor)),
    ]);
    const rows = (await this.listAll(...args)).filter(
      (row) =>
        sameTenant(row.tenant, tenantId) &&
        (descendantIds.has(relationId(row.descendant)) ||
          ancestorIds.has(relationId(row.ancestor)))
    );
    for (const row of rows) {
      await this.deleteById(row.id, ...args);
    }
  }
}
