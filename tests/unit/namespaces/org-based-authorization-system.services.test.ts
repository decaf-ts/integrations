import {
  GroupMembershipService,
  PrincipalService,
  StorageBindingService,
  TenantService,
} from "../../../src/namespaces/org-based-authorization-system.services";
import {
  IsolationTier,
  MembershipStatus,
  PrincipalKind,
  StorageBindingKind,
  StorageKind,
} from "../../../src/namespaces/org-based-authorization-system";

describe("DECAF-33 org-based authorization services", () => {
  it("creates a tenant with a default pooled isolation tier", async () => {
    const service = new TenantService();
    (service as any)._repository = {
      create: async (model: any) => model,
    };

    await expect(
      service.createTenant({
        slug: "tenant-1",
        name: "Tenant One",
      })
    ).resolves.toMatchObject({
      slug: "tenant-1",
      name: "Tenant One",
      isolationTier: IsolationTier.Pooled,
    });
  });

  it("creates a storage binding for the requested storage kind", async () => {
    const service = new StorageBindingService();
    (service as any)._repository = {
      create: async (model: any) => model,
    };

    await expect(
      service.createBinding({
        tenantId: "tenant-1",
        storageKind: StorageKind.Qdrant,
        bindingKind: StorageBindingKind.Shared,
        bindingKey: "qdrant-shared",
        region: "eu-west-1",
        config: { replicas: 1 },
      })
    ).resolves.toMatchObject({
      tenant: "tenant-1",
      storageKind: StorageKind.Qdrant,
      bindingKind: StorageBindingKind.Shared,
      bindingKey: "qdrant-shared",
      region: "eu-west-1",
    });
  });

  it("resolves group principal ids for a principal through group memberships", async () => {
    const service = new GroupMembershipService();
    jest.spyOn(service, "listPrincipalGroups").mockResolvedValue([
      {
        id: "gm-1",
        tenant: "tenant-1",
        group: "group-1",
        principal: "principal-1",
        metadata: {},
        createdAt: new Date(),
      } as any,
      {
        id: "gm-2",
        tenant: "tenant-1",
        group: "group-2",
        principal: "principal-1",
        metadata: {},
        createdAt: new Date(),
      } as any,
    ]);

    const principalSpy = jest
      .spyOn(PrincipalService.prototype, "getGroupPrincipal")
      .mockResolvedValueOnce({
        id: "group-principal-1",
        tenant: "tenant-1",
        kind: PrincipalKind.Group,
        subjectId: "group-1",
      } as any)
      .mockResolvedValueOnce({
        id: "group-principal-2",
        tenant: "tenant-1",
        kind: PrincipalKind.Group,
        subjectId: "group-2",
      } as any);

    await expect(
      service.resolveGroupPrincipalIdsForPrincipal("principal-1")
    ).resolves.toEqual(["group-principal-1", "group-principal-2"]);

    principalSpy.mockRestore();
  });
});
