import { BaseModelService, sameTenant } from "../utils";
import { PrincipalKind } from "../types";
import { Principal } from "../models/principal.model";

export class PrincipalService extends BaseModelService<Principal> {
  constructor() {
    super(Principal);
  }

  async createPrincipal(
    tenantId: string,
    kind: PrincipalKind,
    subjectId: string,
    ...args: any[]
  ): Promise<Principal> {
    return this.create(
      {
        tenant: tenantId,
        kind,
        subjectId,
      },
      ...args
    );
  }

  async getForSubject(
    tenantId: string,
    kind: PrincipalKind,
    subjectId: string,
    ...args: any[]
  ): Promise<Principal | undefined> {
    return (await this.listAll(...args)).find(
      (principal) =>
        sameTenant(principal.tenant, tenantId) &&
        principal.kind === kind &&
        principal.subjectId === subjectId
    );
  }

  async getOrCreateForSubject(
    tenantId: string,
    kind: PrincipalKind,
    subjectId: string,
    ...args: any[]
  ): Promise<Principal> {
    return (await this.getForSubject(tenantId, kind, subjectId, ...args)) ?? (await this.createPrincipal(tenantId, kind, subjectId, ...args));
  }

  async getUserPrincipal(tenantId: string, userId: string, ...args: any[]): Promise<Principal> {
    return this.getOrCreateForSubject(tenantId, PrincipalKind.User, userId, ...args);
  }

  async getGroupPrincipal(tenantId: string, groupId: string, ...args: any[]): Promise<Principal> {
    return this.getOrCreateForSubject(tenantId, PrincipalKind.Group, groupId, ...args);
  }
}
