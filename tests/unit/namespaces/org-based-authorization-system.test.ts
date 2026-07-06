import { AuthzService } from "../../../src/namespaces/services/authz.service";
import { ResourceVisibility, ScopeKind } from "../../../src/namespaces/types";
import { buildAccessContext, buildArangoContext, buildQdrantFilter } from "../../../src/namespaces/utils";

describe("DECAF-33 org-based authorization namespace", () => {
  it("builds an Arango context from allowed ids", async () => {
    expect(
      buildArangoContext({
        tenantId: "tenant-1",
        principalId: "principal-1",
        permissionKey: "content.read",
        allowedOrgUnitIds: ["org-1", "org-2"],
        allowedResourceIds: ["res-1"],
      })
    ).toEqual({
      tenantId: "tenant-1",
      principalId: "principal-1",
      permissionKey: "content.read",
      allowedOrgUnitIds: ["org-1", "org-2"],
      allowedResourceIds: ["res-1"],
    });
  });

  it("builds a Qdrant filter requiring tenant and one of the allowed selectors", async () => {
    expect(
      buildQdrantFilter({
        tenantId: "tenant-1",
        principalId: "principal-1",
        permissionKey: "content.read",
        allowedOrgUnitIds: ["org-1", "org-2"],
        allowedResourceIds: ["res-1"],
      })
    ).toEqual({
      must: [
        {
          key: "tenant_id",
          match: { value: "tenant-1" },
        },
        {
          should: [
            { key: "org_unit_id", match: { any: ["org-1", "org-2"] } },
            { key: "protected_resource_id", match: { any: ["res-1"] } },
            { key: "owner_principal_id", match: { value: "principal-1" } },
          ],
        },
      ],
    });
  });

  it("builds an access context from permissions and grants", async () => {
    expect(
      buildAccessContext({
        tenantId: "tenant-1",
        principalId: "principal-1",
        permissions: [
          {
            id: "ep-1",
            tenantId: "tenant-1",
            principalId: "principal-1",
            permissionKey: "content.read",
            scopeKind: ScopeKind.OrgUnit,
            scopeId: "org-1",
            sourceKind: "role",
            sourceId: "role-1",
          },
        ],
        grants: [
          {
            id: "g-1",
            tenantId: "tenant-1",
            resourceId: "resource-1",
            principalId: "principal-1",
            permissionKey: "content.read",
          },
        ],
      })
    ).toEqual({
      tenantId: "tenant-1",
      principalId: "principal-1",
      permissionsByScope: {
        "org_unit:org-1": ["content.read"],
      },
      allowedOrgUnitIdsByPermission: {
        "content.read": ["org-1"],
      },
      resourceGrants: [{ resourceId: "resource-1", permissionKey: "content.read" }],
    });
  });

  it("checks resource access using the provided data sources", async () => {
    const authz = new AuthzService({
      loadResource: async () => ({
        id: "resource-1",
        tenantId: "tenant-1",
        orgUnitId: "org-1",
        resourceType: "memory",
        resourceId: "res-1",
        visibility: ResourceVisibility.OrgUnit,
        ownerPrincipalId: "principal-2",
      }),
      listResourceGrants: async () => [],
      listEffectivePermissionsForScope: async (
        tenantId,
        scopeKind,
        scopeId
      ) =>
        tenantId === "tenant-1" &&
        scopeKind === ScopeKind.OrgUnit &&
        scopeId === "org-1"
          ? [
              {
                id: "ep-1",
                tenantId: "tenant-1",
                principalId: "principal-1",
                permissionKey: "content.read",
                scopeKind: ScopeKind.OrgUnit,
                scopeId: "org-1",
                sourceKind: "role",
                sourceId: "role-1",
              },
            ]
          : [],
      listPrincipalGrants: async () => [],
      listEffectivePermissions: async () => [],
    });

    await expect(
      authz.canAccess({
        tenantId: "tenant-1",
        principalId: "principal-1",
        permissionKey: "content.read",
        resourceProtectedId: "resource-1",
      })
    ).resolves.toBe(true);

    await expect(
      authz.canAccess({
        tenantId: "tenant-2",
        principalId: "principal-1",
        permissionKey: "content.read",
        resourceProtectedId: "resource-1",
      })
    ).resolves.toBe(false);
  });
});
