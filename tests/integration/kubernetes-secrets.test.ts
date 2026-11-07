/**
 * @module integrations/tests/kubernetes-secrets-integration
 * @summary Real-cluster coverage for {@link KubernetesSecretService}.
 * @description Runs against a reachable Kubernetes API server. The suite is
 * opt-in because it needs a cluster: set `DECAF_KUBERNETES_IT=1` together with a
 * valid `KUBECONFIG` (a minikube profile works):
 *
 * ```
 * minikube start
 * npm run test:integration:kubernetes
 * ```
 *
 * The suite creates a disposable namespace, exercises the full CRUD contract,
 * and removes the namespace afterwards.
 */
import { it } from "@decaf-ts/for-testing";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  ApiException,
  CoreV1Api,
  KubeConfig,
  type V1Namespace,
} from "@kubernetes/client-node";
import { NotFoundError } from "@decaf-ts/db-decorators";
import {
  KubernetesSecretService,
  KubernetesSecretServiceConfig,
} from "../../src/secrets/kubernetes";

const kubeconfigPath =
  process.env.KUBECONFIG || path.join(os.homedir(), ".kube", "config");

async function isClusterReachable(): Promise<boolean> {
  if (process.env.DECAF_KUBERNETES_IT !== "1") return false;
  if (!fs.existsSync(kubeconfigPath)) return false;

  try {
    const probeConfig = new KubeConfig();
    probeConfig.loadFromFile(kubeconfigPath);
    const probeClient = probeConfig.makeApiClient(CoreV1Api);
    await Promise.race([
      probeClient.readNamespace({ name: "default" }),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error("probe timed out")), 5000)
      ),
    ]);
    return true;
  } catch {
    return false;
  }
}

const run = (await isClusterReachable()) ? describe : describe.skip;

const namespace = `decaf-secrets-it-${Date.now()}`;
const secretName = "test-secret";

let adminClient: CoreV1Api;
let secretService: KubernetesSecretService;
let config: KubernetesSecretServiceConfig;

async function waitForNamespace(): Promise<void> {
  for (let attempt = 0; attempt < 60; attempt++) {
    const ns = await adminClient.readNamespace({ name: namespace });
    if (ns.status?.phase === "Active") return;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`Namespace "${namespace}" did not become active`);
}

run("Kubernetes Secrets Integration Tests", () => {
  beforeAll(async () => {
    const kubeConfig = new KubeConfig();
    kubeConfig.loadFromFile(kubeconfigPath);
    adminClient = kubeConfig.makeApiClient(CoreV1Api);

    try {
      await adminClient.createNamespace({
        body: { metadata: { name: namespace } } as V1Namespace,
      });
    } catch (error) {
      if (!(error instanceof ApiException) || error.code !== 409) throw error;
    }
    await waitForNamespace();

    config = {
      provider: "kubernetes",
      kubeconfig: kubeconfigPath,
      namespace,
    };
    secretService = new KubernetesSecretService();
    await secretService.initialize(config);
  }, 120000);

  afterAll(async () => {
    if (adminClient) {
      try {
        await adminClient.deleteNamespace({ name: namespace });
      } catch (error) {
        if (!(error instanceof ApiException) || error.code !== 404) throw error;
      }
    }
  }, 120000);

  describe("Secret CRUD", () => {
    it("stores a secret", async () => {
      const reference = await secretService.store(secretName, {
        username: "testuser",
        password: "password123",
        email: "test@example.com",
      });

      expect(reference).not.toBeNull();
      expect(reference.name).toBe(secretName);
      expect(reference.provider).toBe("kubernetes");
      expect(reference.namespace).toBe(namespace);
    });

    it("retrieves a secret", async () => {
      const secret = await secretService.retrieve(secretName);
      const data = secret as Record<string, unknown>;
      expect(data.username).toBe("testuser");
      expect(data.email).toBe("test@example.com");
    });

    it("checks that a secret exists", async () => {
      expect(await secretService.exists(secretName)).toBe(true);
      expect(await secretService.exists("does-not-exist")).toBe(false);
    });

    it("updates a secret", async () => {
      await secretService.store(secretName, {
        username: "testuser",
        password: "newpassword456",
        email: "updated@example.com",
      });

      const secret = await secretService.retrieve(secretName);
      const data = secret as Record<string, unknown>;
      expect(data.password).toBe("newpassword456");
      expect(data.email).toBe("updated@example.com");
    });

    it("lists secrets", async () => {
      const secrets = await secretService.list();
      expect(secrets.map((item) => item.name)).toContain(secretName);
    });

    it("gets secret metadata", async () => {
      const metadata = await secretService.metadata(secretName);
      expect(metadata).not.toBeUndefined();
      expect(metadata!.name).toBe(secretName);
      expect(metadata!.provider).toBe("kubernetes");
      expect(metadata!.createdAt).toBeInstanceOf(Date);
    });

    it("stores and retrieves string and binary payloads", async () => {
      await secretService.store("string-secret", "plain-value");
      await expect(secretService.retrieve("string-secret")).resolves.toBe(
        "plain-value"
      );

      await secretService.store("binary-secret", new Uint8Array([1, 2, 3, 4]));
      const binary = (await secretService.retrieve("binary-secret")) as Buffer;
      expect(binary.toJSON().data).toEqual([1, 2, 3, 4]);
    });

    it("honors logical versions", async () => {
      await secretService.store("versioned-secret", "v1", { version: "v1" });
      await expect(
        secretService.retrieve("versioned-secret", { version: "v1" })
      ).resolves.toBe("v1");
      await expect(
        secretService.retrieve("versioned-secret", { version: "v2" })
      ).rejects.toBeInstanceOf(NotFoundError);
    });

    it("supports per-call namespace overrides", async () => {
      const otherNamespace = `${namespace}-other`.slice(0, 63);
      try {
        await adminClient.createNamespace({
          body: { metadata: { name: otherNamespace } } as V1Namespace,
        });
        await new Promise((resolve) => setTimeout(resolve, 1000));

        await secretService.store("cross-namespace", "value", {
          namespace: otherNamespace,
        });
        await expect(
          secretService.retrieve("cross-namespace", {
            namespace: otherNamespace,
          })
        ).resolves.toBe("value");
        await expect(
          secretService.exists("cross-namespace")
        ).resolves.toBe(false);
        await secretService.delete("cross-namespace", {
          namespace: otherNamespace,
        });
      } finally {
        await adminClient
          .deleteNamespace({ name: otherNamespace })
          .catch(() => undefined);
      }
    });

    it("deletes a secret", async () => {
      await secretService.delete(secretName);
      expect(await secretService.exists(secretName)).toBe(false);
      await expect(secretService.retrieve(secretName)).rejects.toThrow();
    });
  });
});
