import { BaseModelService, id, relationMatch } from "../utils";
import { OrgUnitProfile } from "../models/org-unit-profile.model";

export class OrgUnitProfileService extends BaseModelService<OrgUnitProfile> {
  constructor() {
    super(OrgUnitProfile);
  }

  async createProfile(
    orgUnitId: string,
    profileKey: string,
    metadata?: Record<string, unknown>,
    ...args: any[]
  ): Promise<OrgUnitProfile> {
    return this.create(
      {
        orgUnit: orgUnitId,
        profileKey,
        metadata,
      },
      ...args
    );
  }

  async listForOrgUnit(orgUnitId: string, ...args: any[]): Promise<OrgUnitProfile[]> {
    return (await this.listAll(...args)).filter((profile) => relationMatch(profile.orgUnit, orgUnitId));
  }
}
