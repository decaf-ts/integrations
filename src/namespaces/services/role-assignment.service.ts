import { BaseModelService, relationMatch, sameTenant } from "../utils";
import { AssignRoleInput } from "../types";
import { RoleAssignment } from "../models/role-assignment.model";

export class RoleAssignmentService extends BaseModelService<RoleAssignment> {
  constructor() {
    super(RoleAssignment);
  }

  async assignRole(
    input: AssignRoleInput,
    ...args: any[]
  ): Promise<RoleAssignment> {
    return this.create(
      {
        tenant: input.tenantId,
        principal: input.principalId,
        role: input.roleId,
        scopeKind: input.scopeKind,
        scopeId: input.scopeId,
        inheritDown: input.inheritDown ?? false,
        startsAt: input.startsAt,
        expiresAt: input.expiresAt,
        conditions: input.conditions,
      },
      ...args
    );
  }

  async revokeAssignment(assignmentId: string, ...args: any[]): Promise<void> {
    await this.deleteById(assignmentId, ...args);
  }

  async listPrincipalAssignments(
    tenantId: string,
    principalId: string,
    ...args: any[]
  ): Promise<RoleAssignment[]> {
    return (await this.listAll(...args)).filter(
      (assignment) =>
        sameTenant(assignment.tenant, tenantId) &&
        relationMatch(assignment.principal, principalId)
    );
  }

  async listRoleAssignments(
    roleId: string,
    ...args: any[]
  ): Promise<RoleAssignment[]> {
    return (await this.listAll(...args)).filter((assignment) =>
      relationMatch(assignment.role, roleId)
    );
  }

  async listTenantAssignments(
    tenantId: string,
    ...args: any[]
  ): Promise<RoleAssignment[]> {
    return (await this.listAll(...args)).filter((assignment) =>
      sameTenant(assignment.tenant, tenantId)
    );
  }

  async updateAssignmentWindow(
    assignmentId: string,
    startsAt: Date | undefined,
    expiresAt: Date | undefined,
    ...args: any[]
  ): Promise<RoleAssignment> {
    return this.updateOne(assignmentId, { startsAt, expiresAt }, ...args);
  }
}
