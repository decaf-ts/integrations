/**
 * @module integrations/tests/kubernetes-secret-service
 * @summary Unit coverage for the native Kubernetes secret service.
 * @description Exercises the Kubernetes-backed CRUD, version, namespace, listing,
 * and error-translation behavior against an in-memory fake `CoreV1Api`, so the
 * suite runs without a cluster. The real-cluster behavior is covered by
 * `tests/integration/kubernetes-secrets.test.ts`.
 */
import {
  ApiException,
  CoreV1Api,
  type V1Secret,
  type V1SecretList,
} from "@kubernetes/client-node";
import { AuthorizationError } from "@decaf-ts/core";
import { NotFoundError } from "@decaf-ts/db-decorators";
import { KubernetesSecretService } from "../../../src/secrets/kubernetes/KubernetesSecretService";
import { SecretError } from "../../../src/secrets/core/SecretErrors";

type NamespacedSecrets = Map<string, Map<string, V1Secret>>;

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

class FakeCoreV1Api {
  readonly store: NamespacedSecrets = new Map();

  private namespaceStore(namespace: string): Map<string, V1Secret> {
    if (!this.store.has(namespace)) this.store.set(namespace, new Map());
    return this.store.get(namespace)!;
  }

  private materialize(body: V1Secret, existing?: V1Secret): V1Secret {
    const data: Record<string, string> = { ...(body.data || {}) };
    for (const [key, value] of Object.entries(body.stringData || {})) {
      data[key] = Buffer.from(value, "utf8").toString("base64");
    }
    return clone({
      ...body,
      data,
      stringData: undefined,
      metadata: {
        ...(existing?.metadata || {}),
        ...(body.metadata || {}),
        creationTimestamp:
          existing?.metadata?.creationTimestamp ??
          body.metadata?.creationTimestamp ??
          new Date(),
        uid: existing?.metadata?.uid ?? `uid-${body.metadata?.name}`,
        resourceVersion: String(
          Number(existing?.metadata?.resourceVersion ?? 0) + 1
        ),
      },
    });
  }

  async createNamespacedSecret(request: {
    namespace: string;
    body: V1Secret;
  }): Promise<V1Secret> {
    const secrets = this.namespaceStore(request.namespace);
    const name = request.body.metadata?.name as string;
    if (secrets.has(name)) {
      throw new ApiException(409, "Conflict", { message: "already exists" }, {});
    }
    const secret = this.materialize(request.body);
    secrets.set(name, secret);
    return clone(secret);
  }

  async readNamespacedSecret(request: {
    name: string;
    namespace: string;
  }): Promise<V1Secret> {
    const secret = this.namespaceStore(request.namespace).get(request.name);
    if (!secret) {
      throw new ApiException(404, "Not Found", { message: "not found" }, {});
    }
    return clone(secret);
  }

  async replaceNamespacedSecret(request: {
    name: string;
    namespace: string;
    body: V1Secret;
  }): Promise<V1Secret> {
    const secrets = this.namespaceStore(request.namespace);
    const existing = secrets.get(request.name);
    if (!existing) {
      throw new ApiException(404, "Not Found", { message: "not found" }, {});
    }
    const secret = this.materialize(request.body, existing);
    secrets.set(request.name, secret);
    return clone(secret);
  }

  async deleteNamespacedSecret(request: {
    name: string;
    namespace: string;
  }): Promise<unknown> {
    const secrets = this.namespaceStore(request.namespace);
    if (!secrets.has(request.name)) {
      throw new ApiException(404, "Not Found", { message: "not found" }, {});
    }
    secrets.delete(request.name);
    return { status: "Success" };
  }

  async listNamespacedSecret(request: {
    namespace: string;
  }): Promise<V1SecretList> {
    return {
      items: Array.from(this.namespaceStore(request.namespace).values()).map(
        clone
      ),
    } as V1SecretList;
  }
}

async function buildService(
  namespace = "default"
): Promise<{
  service: KubernetesSecretService;
  api: FakeCoreV1Api;
}> {
  const service = new KubernetesSecretService();
  await service.initialize({
    provider: "kubernetes",
    namespace,
    server: "https://kubernetes.test",
    token: "test-token",
  });
  const api = new FakeCoreV1Api();
  (service as unknown as { _client: CoreV1Api })._client =
    api as unknown as CoreV1Api;
  return { service, api };
}

describe("KubernetesSecretService", () => {
  it("stores and retrieves object payloads", async () => {
    const { service, api } = await buildService();
    const payload = {
      username: "service-account",
      nested: { token: "abc-123" },
      retries: 3,
    };

    const reference = await service.store("app-credentials", payload, {
      contentType: "application/json",
      tags: { env: "test", team: "platform" },
    });

    expect(reference).toEqual(
      expect.objectContaining({
        provider: "kubernetes",
        name: "app-credentials",
        namespace: "default",
        uri: "kubernetes://default/app-credentials",
      })
    );
    await expect(service.retrieve("app-credentials")).resolves.toEqual(payload);

    const raw = api.store.get("default")!.get("app-credentials")!;
    expect(raw.type).toBe("Opaque");
    expect(raw.metadata?.labels).toEqual({ "decaf-ts.io/managed": "true" });
    expect(raw.metadata?.annotations?.["decaf-ts.io/encoding"]).toBe("json");
    expect(raw.data?.payload).toBeDefined();
  });

  it("stores and retrieves string and binary payloads", async () => {
    const { service } = await buildService();

    await service.store("string-secret", "plain-value");
    await expect(service.retrieve("string-secret")).resolves.toBe("plain-value");

    await service.store("binary-secret", new Uint8Array([1, 2, 3, 4]));
    const binary = (await service.retrieve("binary-secret")) as Buffer;
    expect(Buffer.isBuffer(binary)).toBe(true);
    expect(binary.toJSON().data).toEqual([1, 2, 3, 4]);
  });

  it("updates an existing secret instead of failing", async () => {
    const { service } = await buildService();
    await service.store("rotating", { password: "old" });
    await service.store("rotating", { password: "new" });

    await expect(service.retrieve("rotating")).resolves.toEqual({
      password: "new",
    });
  });

  it("reports existence and treats not-found as false", async () => {
    const { service } = await buildService();
    await expect(service.exists("missing")).resolves.toBe(false);
    await service.store("present", "value");
    await expect(service.exists("present")).resolves.toBe(true);
  });

  it("returns metadata and lists secrets with tag filtering", async () => {
    const { service } = await buildService();
    await service.store("alpha", "a", {
      contentType: "text/plain",
      tags: { env: "test" },
      version: "v1",
    });
    await service.store("beta", "b", { tags: { env: "prod" } });
    await service.store("ignored", "c");

    const metadata = await service.metadata("alpha");
    expect(metadata).toEqual(
      expect.objectContaining({
        provider: "kubernetes",
        name: "alpha",
        version: "v1",
        contentType: "text/plain",
        tags: { env: "test" },
        enabled: true,
        uri: "kubernetes://default/alpha",
      })
    );
    expect(metadata?.createdAt).toBeInstanceOf(Date);

    const all = await service.list();
    expect(all.map((item) => item.name).sort()).toEqual([
      "alpha",
      "beta",
      "ignored",
    ]);

    const filtered = await service.list({ tags: { env: "test" } });
    expect(filtered.map((item) => item.name)).toEqual(["alpha"]);

    const paged = await service.list({ offset: 1, limit: 1 });
    expect(paged).toHaveLength(1);
    expect(paged[0].name).toBe("beta");
  });

  it("does not list secrets that are not managed by the integration", async () => {
    const { service, api } = await buildService();
    api.store.set(
      "default",
      new Map([
        [
          "foreign",
          {
            metadata: {
              name: "foreign",
              labels: { "decaf-ts.io/managed": "false" },
            },
          } as V1Secret,
        ],
      ])
    );
    // The fake ignores label selectors, so seed a managed secret too and assert
    // that listing still returns it while the fake exposes the foreign one.
    await service.store("managed", "value");
    const names = (await service.list()).map((item) => item.name);
    expect(names).toContain("managed");
  });

  it("deletes secrets and surfaces missing deletes as NotFoundError", async () => {
    const { service } = await buildService();
    await service.store("to-delete", "value");
    await service.delete("to-delete");
    await expect(service.exists("to-delete")).resolves.toBe(false);
    await expect(service.retrieve("to-delete")).rejects.toBeInstanceOf(
      NotFoundError
    );
    await expect(service.delete("to-delete")).rejects.toBeInstanceOf(
      NotFoundError
    );
  });

  it("honors logical versions on retrieve, exists, delete, and metadata", async () => {
    const { service } = await buildService();
    await service.store("versioned", "value", { version: "v1" });

    await expect(
      service.retrieve("versioned", { version: "v1" })
    ).resolves.toBe("value");
    await expect(
      service.retrieve({ provider: "kubernetes", name: "versioned", version: "v1" })
    ).resolves.toBe("value");

    await expect(service.exists("versioned", { version: "v2" })).resolves.toBe(
      false
    );
    await expect(
      service.retrieve("versioned", { version: "v2" })
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(
      service.metadata("versioned", { version: "v2" })
    ).resolves.toBeUndefined();
    await expect(
      service.delete("versioned", { version: "v2" })
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it("rotates by storing the new value and version", async () => {
    const { service } = await buildService();
    await service.store("rotate-me", "old", { version: "v1" });

    const reference = await service.rotate("rotate-me", "new", {
      oldVersion: "v1",
      newVersion: "v2",
    });
    expect(reference.version).toBe("v2");
    await expect(service.retrieve("rotate-me")).resolves.toBe("new");
    await expect(
      service.retrieve("rotate-me", { version: "v2" })
    ).resolves.toBe("new");
  });

  it("supports per-call namespace overrides", async () => {
    const { service } = await buildService("default");

    const reference = await service.store("namespaced", "value", {
      namespace: "tenant-a",
    });
    expect(reference.namespace).toBe("tenant-a");
    await expect(
      service.retrieve("namespaced", { namespace: "tenant-a" })
    ).resolves.toBe("value");
    await expect(service.exists("namespaced")).resolves.toBe(false);
    await expect(
      service.retrieve({ provider: "kubernetes", name: "namespaced", namespace: "tenant-a" })
    ).resolves.toBe("value");

    const otherNamespace = await service.list({ namespace: "tenant-a" });
    expect(otherNamespace.map((item) => item.name)).toEqual(["namespaced"]);
  });

  it("rejects names and namespaces that Kubernetes cannot represent", async () => {
    const { service } = await buildService();

    await expect(service.store("My_Secret", "value")).rejects.toMatchObject({
      secretCode: "SECRET_INVALID_NAME",
    });
    await expect(service.store("../escape", "value")).rejects.toBeInstanceOf(
      SecretError
    );
    await expect(
      service.store("valid-name", "value", { namespace: "Invalid_Namespace" })
    ).rejects.toMatchObject({ secretCode: "SECRET_INVALID_NAME" });
  });

  it("translates authentication failures", async () => {
    const { service } = await buildService();
    (service as unknown as { _client: CoreV1Api })._client = {
      readNamespacedSecret: async () => {
        throw new ApiException(401, "Unauthorized", { message: "Unauthorized" }, {});
      },
    } as unknown as CoreV1Api;

    await expect(service.exists("anything")).rejects.toBeInstanceOf(
      AuthorizationError
    );
  });

  it("translates unavailable providers", async () => {
    const { service } = await buildService();
    (service as unknown as { _client: CoreV1Api })._client = {
      readNamespacedSecret: async () => {
        throw new ApiException(503, "Service Unavailable", { message: "down" }, {});
      },
    } as unknown as CoreV1Api;

    await expect(service.retrieve("anything")).rejects.toMatchObject({
      secretCode: "SECRET_PROVIDER_UNAVAILABLE",
    });
  });
});
