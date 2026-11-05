import {
  ApiException,
  CoreV1Api,
  KubeConfig,
  type V1Secret,
} from "@kubernetes/client-node";
import { AuthorizationError, type MaybeContextualArg } from "@decaf-ts/core";
import {
  ClientBasedSecretService,
  SecretError,
  SecretProvider,
  SecretName,
  SecretPayload,
  SecretReference,
  SecretMetadata,
} from "../../secrets/core";
import {
  StoreSecretOptions,
  RetrieveSecretOptions,
  DeleteSecretOptions,
  ExistsSecretOptions,
  ListSecretsOptions,
  SecretMetadataOptions,
  RotateSecretOptions,
} from "../../secrets/core";
import { validateSecretName, normalizeSecretName } from "../../secrets/core";
import {
  serializeSecretPayload,
  deserializeSecretPayload,
  type SerializedSecretPayload,
} from "../../secrets/core";
import { KubernetesSecretServiceConfig } from "./KubernetesSecretServiceConfig";
import { KubernetesSecretEnvironment } from "./KubernetesSecretEnvironment";
import { envBoolean, envString } from "../../shared/environmentValue";
import {
  BadRequestError,
  BaseError,
  ConflictError,
  InternalError,
  NotFoundError,
} from "@decaf-ts/db-decorators";

const PAYLOAD_DATA_KEY = "payload";
const MANAGED_LABEL = "decaf-ts.io/managed";
const ANNOTATION_PREFIX = "decaf-ts.io/";
const ENCODING_ANNOTATION = `${ANNOTATION_PREFIX}encoding`;
const CONTENT_TYPE_ANNOTATION = `${ANNOTATION_PREFIX}content-type`;
const TAGS_ANNOTATION = `${ANNOTATION_PREFIX}tags`;
const VERSION_ANNOTATION = `${ANNOTATION_PREFIX}version`;
const UPDATED_AT_ANNOTATION = `${ANNOTATION_PREFIX}updated-at`;
const TENANT_ANNOTATION = `${ANNOTATION_PREFIX}tenant-id`;
const ORG_UNIT_ANNOTATION = `${ANNOTATION_PREFIX}org-unit-id`;
const OWNER_ANNOTATION = `${ANNOTATION_PREFIX}owner-principal-id`;

const DNS_SUBDOMAIN_PATTERN =
  /^[a-z0-9]([-a-z0-9.]*[a-z0-9])?$/;
const DNS_LABEL_PATTERN = /^[a-z0-9]([-a-z0-9]*[a-z0-9])?$/;

function assertKubernetesName(name: string): void {
  if (name.length > 253 || !DNS_SUBDOMAIN_PATTERN.test(name)) {
    throw new SecretError(
      "SECRET_INVALID_NAME",
      `Invalid Kubernetes secret name: "${name}". Names must be lowercase DNS-1123 subdomains (letters, digits, '-', and '.').`
    );
  }
}

function assertKubernetesNamespace(namespace: string): void {
  if (namespace.length > 63 || !DNS_LABEL_PATTERN.test(namespace)) {
    throw new SecretError(
      "SECRET_INVALID_NAME",
      `Invalid Kubernetes namespace: "${namespace}". Namespaces must be lowercase DNS-1123 labels.`
    );
  }
}

function toDate(value: Date | string | undefined): Date | undefined {
  if (!value) return undefined;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

function parseTags(raw: string | undefined): Record<string, string> | undefined {
  if (!raw) return undefined;
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object"
      ? (parsed as Record<string, string>)
      : undefined;
  } catch {
    return undefined;
  }
}

/**
 * @class KubernetesSecretService
 * @summary Native Kubernetes Secrets backend.
 * @description Implements the {@link SecretService} contract on top of
 * namespaced Kubernetes `Secret` objects. Each DECAF secret is stored as an
 * `Opaque` Secret whose `payload` data key holds the serialized
 * {@link SerializedSecretPayload} envelope, while encoding, content type, tags,
 * logical version, and ownership hints live in `decaf-ts.io/*` annotations.
 *
 * Authentication uses the standard Kubernetes client resolution order:
 * explicit `server` credentials, an explicit `kubeconfig` path, `KUBECONFIG`,
 * `~/.kube/config`, and finally the in-cluster service account.
 */
export class KubernetesSecretService extends ClientBasedSecretService<
  CoreV1Api,
  KubernetesSecretServiceConfig
> {
  readonly provider: SecretProvider = "kubernetes";

  protected configFromEnvironment():
    | KubernetesSecretServiceConfig
    | undefined {
    const env = KubernetesSecretEnvironment.secrets.kubernetes;
    const namespace = envString(env?.namespace);
    const kubeconfig = envString(env?.kubeconfig);
    const context = envString(env?.context);
    const server = envString(env?.server);
    if (!namespace && !kubeconfig && !context && !server) return undefined;
    return {
      provider: "kubernetes",
      namespace,
      kubeconfig,
      context,
      server,
      token: envString(env.token),
      tokenFile: envString(env.tokenFile),
      caFile: envString(env.caFile),
      caData: envString(env.caData),
      certFile: envString(env.certFile),
      keyFile: envString(env.keyFile),
      certData: envString(env.certData),
      keyData: envString(env.keyData),
      skipTLSVerify: envBoolean(env.skipTLSVerify),
      serviceAccount: envBoolean(env.serviceAccount),
    };
  }

  async initialize(
    ...args: MaybeContextualArg<any>
  ): Promise<{ config: KubernetesSecretServiceConfig; client: CoreV1Api }> {
    const { log } = (await this.logCtx(args, "initialize", true)).for(
      this.initialize
    );
    const config =
      this.getConfigFromArgs<KubernetesSecretServiceConfig>(...args);
    const kubeConfig = this.buildKubeConfig(config);
    const namespace = this.resolveNamespace(config, kubeConfig);
    const resolved: KubernetesSecretServiceConfig = { ...config, namespace };
    const client = kubeConfig.makeApiClient(CoreV1Api);
    this._config = resolved;
    this._client = client;
    log.verbose(
      `Initialized Kubernetes secret service for namespace "${namespace}"`
    );
    return { config: resolved, client };
  }

  async store<T extends SecretPayload = SecretPayload>(
    name: SecretName,
    value: T,
    options: StoreSecretOptions = {},
    ...args: MaybeContextualArg<any>
  ): Promise<SecretReference> {
    const { log } = (await this.logCtx(args, "store", true)).for(this.store);
    const normalizedName = this.normalizeName(name);
    const namespace = this.resolveNamespaceOption(options.namespace);
    log.verbose(`Storing secret ${normalizedName} in namespace ${namespace}`);

    const serialized = serializeSecretPayload(value);
    const body = this.buildSecret(normalizedName, namespace, serialized, options);

    try {
      await this.client.createNamespacedSecret({ namespace, body });
    } catch (error) {
      if (this.statusOf(error) === 409) {
        try {
          const existing = await this.client.readNamespacedSecret({
            name: normalizedName,
            namespace,
          });
          body.metadata = {
            ...(body.metadata || {}),
            resourceVersion: existing.metadata?.resourceVersion,
          };
          await this.client.replaceNamespacedSecret({
            name: normalizedName,
            namespace,
            body,
          });
        } catch (replaceError) {
          throw this.parseError(replaceError);
        }
      } else {
        throw this.parseError(error);
      }
    }

    return {
      provider: this.provider,
      name: normalizedName,
      namespace,
      version: options.version,
      uri: `kubernetes://${namespace}/${normalizedName}`,
    };
  }

  async retrieve<T extends SecretPayload = SecretPayload>(
    nameOrRef: SecretName | SecretReference,
    options: RetrieveSecretOptions = {},
    ...args: MaybeContextualArg<any>
  ): Promise<T> {
    const { log } = (await this.logCtx(args, "retrieve", true)).for(
      this.retrieve
    );
    const { name, namespace, version } = this.resolveReference(
      nameOrRef,
      options
    );
    log.verbose(`Retrieving secret ${name} from namespace ${namespace}`);

    const secret = await this.readSecret(name, namespace);
    this.assertVersion(secret, version);

    const raw = secret.data?.[PAYLOAD_DATA_KEY];
    if (!raw) {
      throw new NotFoundError(
        `No secret value found for "${name}" in namespace "${namespace}"`
      );
    }

    let payload: SerializedSecretPayload;
    try {
      payload = JSON.parse(
        Buffer.from(raw, "base64").toString("utf8")
      ) as SerializedSecretPayload;
    } catch (error) {
      throw new SecretError(
        "SECRET_DESERIALIZATION_FAILED",
        `Failed to parse secret payload for "${name}": ${(error as Error).message}`,
        error as Error
      );
    }

    return deserializeSecretPayload(payload) as T;
  }

  async delete(
    nameOrRef: SecretName | SecretReference,
    options: DeleteSecretOptions = {},
    ...args: MaybeContextualArg<any>
  ): Promise<void> {
    const { log } = (await this.logCtx(args, "delete", true)).for(this.delete);
    const { name, namespace, version } = this.resolveReference(
      nameOrRef,
      options
    );
    log.verbose(`Deleting secret ${name} from namespace ${namespace}`);

    if (version) {
      const secret = await this.readSecret(name, namespace);
      this.assertVersion(secret, version);
    }

    try {
      await this.client.deleteNamespacedSecret({ name, namespace });
    } catch (error) {
      throw this.parseError(error);
    }
  }

  async exists(
    nameOrRef: SecretName | SecretReference,
    options: ExistsSecretOptions = {},
    ...args: MaybeContextualArg<any>
  ): Promise<boolean> {
    const { log } = (await this.logCtx(args, "exists", true)).for(this.exists);
    const { name, namespace, version } = this.resolveReference(
      nameOrRef,
      options
    );
    log.verbose(`Checking if secret ${name} exists in namespace ${namespace}`);

    try {
      const secret = await this.readSecret(name, namespace);
      this.assertVersion(secret, version);
      return true;
    } catch (error) {
      if (error instanceof NotFoundError) return false;
      throw error;
    }
  }

  async list(
    options: ListSecretsOptions = {},
    ...args: MaybeContextualArg<any>
  ): Promise<SecretMetadata[]> {
    const { log } = (await this.logCtx(args, "list", true)).for(this.list);
    const namespace = this.resolveNamespaceOption(options.namespace);
    log.verbose(`Listing secrets in namespace ${namespace}`);

    const result: SecretMetadata[] = [];
    let continueToken: string | undefined;

    try {
      do {
        const response = await this.client.listNamespacedSecret({
          namespace,
          labelSelector: `${MANAGED_LABEL}=true`,
          limit: 100,
          _continue: continueToken,
        });

        for (const secret of response.items || []) {
          result.push(this.toMetadata(secret, namespace));
        }

        continueToken = response.metadata?._continue;
      } while (continueToken);
    } catch (error) {
      throw this.parseError(error);
    }

    const filtered = result.filter((meta) => {
      if (options.enabled === false) return false;
      if (!options.tags) return true;
      return Object.entries(options.tags).every(
        ([key, value]) => meta.tags?.[key] === value
      );
    });

    const offset = options.offset ?? 0;
    const end =
      typeof options.limit === "number" ? offset + options.limit : undefined;
    return filtered.slice(offset, end);
  }

  async metadata(
    nameOrRef: SecretName | SecretReference,
    options: SecretMetadataOptions = {},
    ...args: MaybeContextualArg<any>
  ): Promise<SecretMetadata | undefined> {
    const { log } = (await this.logCtx(args, "metadata", true)).for(
      this.metadata
    );
    const { name, namespace, version } = this.resolveReference(
      nameOrRef,
      options
    );
    log.verbose(`Getting metadata for secret ${name} in namespace ${namespace}`);

    try {
      const secret = await this.readSecret(name, namespace);
      this.assertVersion(secret, version);
      return this.toMetadata(secret, namespace);
    } catch (error) {
      if (error instanceof NotFoundError) return undefined;
      throw error;
    }
  }

  async rotate<T extends SecretPayload = SecretPayload>(
    nameOrRef: SecretName | SecretReference,
    value: T,
    options: RotateSecretOptions = {},
    ...args: MaybeContextualArg<any>
  ): Promise<SecretReference> {
    const { name, namespace } = this.resolveReference(nameOrRef, options);
    return this.store(
      name,
      value,
      { version: options.newVersion, namespace },
      ...args
    );
  }

  private buildKubeConfig(config: KubernetesSecretServiceConfig): KubeConfig {
    const kubeConfig = new KubeConfig();
    try {
      if (config.serviceAccount) {
        kubeConfig.loadFromCluster();
      } else if (config.server) {
        const clusterName = "decaf-cluster";
        const userName = "decaf-user";
        const contextName = "decaf-context";
        kubeConfig.loadFromOptions({
          clusters: [
            {
              name: clusterName,
              server: config.server,
              caData: config.caData,
              caFile: config.caFile,
              skipTLSVerify: config.skipTLSVerify,
            },
          ],
          users: [
            {
              name: userName,
              token: config.token,
              tokenFile: config.tokenFile,
              certData: config.certData,
              certFile: config.certFile,
              keyData: config.keyData,
              keyFile: config.keyFile,
            },
          ],
          contexts: [
            {
              name: contextName,
              cluster: clusterName,
              user: userName,
              namespace: config.namespace,
            },
          ],
          currentContext: contextName,
        });
      } else if (config.kubeconfig) {
        kubeConfig.loadFromFile(config.kubeconfig);
      } else {
        kubeConfig.loadFromDefault();
      }

      if (config.context) {
        kubeConfig.setCurrentContext(config.context);
      }
    } catch (error) {
      throw this.parseError(error);
    }
    return kubeConfig;
  }

  private resolveNamespace(
    config: KubernetesSecretServiceConfig,
    kubeConfig: KubeConfig
  ): string {
    const namespace =
      config.namespace ||
      kubeConfig.getContextObject(kubeConfig.getCurrentContext())?.namespace ||
      "default";
    assertKubernetesNamespace(namespace);
    return namespace;
  }

  private resolveNamespaceOption(namespace?: string): string {
    const resolved = namespace || this.config.namespace || "default";
    assertKubernetesNamespace(resolved);
    return resolved;
  }

  private resolveReference(
    nameOrRef: SecretName | SecretReference,
    options: {
      namespace?: string;
      version?: string;
    }
  ): { name: string; namespace: string; version?: string } {
    const name =
      typeof nameOrRef === "string" ? nameOrRef : nameOrRef.name;
    const namespace =
      options.namespace ||
      (typeof nameOrRef === "string" ? undefined : nameOrRef.namespace) ||
      this.config.namespace ||
      "default";
    assertKubernetesNamespace(namespace);
    const version =
      options.version ||
      (typeof nameOrRef === "string" ? undefined : nameOrRef.version);
    return { name: this.normalizeName(name), namespace, version };
  }

  private normalizeName(name: string): string {
    try {
      validateSecretName(name);
    } catch (error) {
      throw this.parseError(error as Error);
    }
    const normalizedName = normalizeSecretName(name);
    assertKubernetesName(normalizedName);
    return normalizedName;
  }

  private buildSecret(
    name: string,
    namespace: string,
    serialized: SerializedSecretPayload,
    options: StoreSecretOptions
  ): V1Secret {
    const annotations: Record<string, string> = {
      [ENCODING_ANNOTATION]: serialized.encoding,
      [UPDATED_AT_ANNOTATION]: new Date().toISOString(),
    };

    if (options.contentType) {
      annotations[CONTENT_TYPE_ANNOTATION] = options.contentType;
    }
    if (options.tags) {
      annotations[TAGS_ANNOTATION] = JSON.stringify(options.tags);
    }
    if (options.version) {
      annotations[VERSION_ANNOTATION] = options.version;
    }
    if (options.tenantId) {
      annotations[TENANT_ANNOTATION] = options.tenantId;
    }
    if (options.orgUnitId) {
      annotations[ORG_UNIT_ANNOTATION] = options.orgUnitId;
    }
    if (options.ownerPrincipalId) {
      annotations[OWNER_ANNOTATION] = options.ownerPrincipalId;
    }

    return {
      apiVersion: "v1",
      kind: "Secret",
      type: "Opaque",
      metadata: {
        name,
        namespace,
        labels: {
          [MANAGED_LABEL]: "true",
        },
        annotations,
      },
      stringData: {
        [PAYLOAD_DATA_KEY]: JSON.stringify(serialized),
      },
    };
  }

  private async readSecret(
    name: string,
    namespace: string
  ): Promise<V1Secret> {
    try {
      return await this.client.readNamespacedSecret({ name, namespace });
    } catch (error) {
      throw this.parseError(error);
    }
  }

  private assertVersion(secret: V1Secret, version?: string): void {
    if (!version) return;
    const stored = secret.metadata?.annotations?.[VERSION_ANNOTATION];
    if (stored !== version) {
      throw new NotFoundError(
        `Secret "${secret.metadata?.name}" version "${version}" not found`
      );
    }
  }

  private toMetadata(secret: V1Secret, namespace: string): SecretMetadata {
    const annotations = secret.metadata?.annotations || {};
    const updatedAt = annotations[UPDATED_AT_ANNOTATION];
    const name = secret.metadata?.name || "";
    return {
      provider: this.provider,
      name,
      version: annotations[VERSION_ANNOTATION],
      createdAt: toDate(secret.metadata?.creationTimestamp),
      updatedAt: updatedAt
        ? new Date(updatedAt)
        : toDate(secret.metadata?.creationTimestamp),
      enabled: true,
      contentType: annotations[CONTENT_TYPE_ANNOTATION],
      tags: parseTags(annotations[TAGS_ANNOTATION]),
      externalId: secret.metadata?.uid,
      uri: `kubernetes://${namespace}/${name}`,
    };
  }

  private statusOf(error: unknown): number | undefined {
    if (error instanceof ApiException) return error.code;
    const candidate = error as { code?: unknown; statusCode?: unknown };
    if (typeof candidate?.code === "number") return candidate.code;
    if (typeof candidate?.statusCode === "number") {
      return candidate.statusCode;
    }
    return undefined;
  }

  private messageOf(error: unknown): string {
    const err = error as {
      message?: string;
      name?: string;
      body?: { message?: string; reason?: string };
    };
    return err?.body?.message || err?.body?.reason || err?.message || err?.name || "Unknown error";
  }

  protected parseError(error: unknown): Error {
    if (error instanceof BaseError) return error;
    const status = this.statusOf(error);
    const message = this.messageOf(error);
    const lowerMessage = message.toLowerCase();

    if (
      status === 404 ||
      lowerMessage.includes("not found") ||
      lowerMessage.includes("404")
    ) {
      return new NotFoundError(message);
    }

    if (
      status === 409 ||
      lowerMessage.includes("already exists") ||
      lowerMessage.includes("conflict") ||
      lowerMessage.includes("409")
    ) {
      return new ConflictError(message);
    }

    if (status === 401 || lowerMessage.includes("unauthorized")) {
      return new AuthorizationError(`Authentication failed: ${message}`);
    }

    if (status === 403 || lowerMessage.includes("forbidden")) {
      return new AuthorizationError(`Permission denied: ${message}`);
    }

    if (
      status === 400 ||
      status === 422 ||
      lowerMessage.includes("bad request")
    ) {
      return new BadRequestError(message);
    }

    if (status === 429 || lowerMessage.includes("rate limit")) {
      return new SecretError(
        "SECRET_PROVIDER_RATE_LIMITED",
        `Rate limited: ${message}`,
        error as Error
      );
    }

    if (
      status === undefined ||
      (status !== undefined && status >= 500) ||
      lowerMessage.includes("connection") ||
      lowerMessage.includes("timeout") ||
      lowerMessage.includes("unavailable")
    ) {
      return new SecretError(
        "SECRET_PROVIDER_UNAVAILABLE",
        `Provider unavailable: ${message}`,
        error as Error
      );
    }

    return new InternalError(message);
  }
}
