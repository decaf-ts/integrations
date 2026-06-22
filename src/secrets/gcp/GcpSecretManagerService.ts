import { SecretManagerServiceClient } from "@google-cloud/secret-manager";
import * as grpc from "@grpc/grpc-js";
import { SecretProvider } from "../../secrets/core";
import { ClientBasedService, type MaybeContextualArg } from "@decaf-ts/core";
import { SecretName, SecretPayload, SecretReference, SecretMetadata } from "../../secrets/core";
import { StoreSecretOptions, ListSecretsOptions } from "../../secrets/core";
import { validateSecretName, normalizeSecretName } from "../../secrets/core";
import { serializeSecretPayload, deserializeSecretPayload, type SerializedSecretPayload } from "../../secrets/core";
import { GcpSecretManagerServiceConfig } from "./GcpSecretManagerServiceConfig";
import {
  BadRequestError,
  ConflictError,
  InternalError,
  NotFoundError,
} from "@decaf-ts/db-decorators";

export class GcpSecretManagerService extends ClientBasedService<SecretManagerServiceClient, GcpSecretManagerServiceConfig> {
  readonly provider: SecretProvider = "gcp-secret-manager";

  async initialize(...args: MaybeContextualArg<any>): Promise<{ config: GcpSecretManagerServiceConfig; client: SecretManagerServiceClient }> {
    const { ctxArgs } = (await this.logCtx(args, "initialize", true)).for(this.initialize);
    const config = ctxArgs[0] as GcpSecretManagerServiceConfig;
    const client = new SecretManagerServiceClient({
      projectId: config.projectId,
      credentials: config.credentials,
      ...(config.apiEndpoint
        ? {
            apiEndpoint: config.apiEndpoint,
            ...(config.port ? { port: config.port } : {}),
            sslCreds: grpc.credentials.createInsecure(),
          }
        : {}),
    });
    this._config = config;
    this._client = client;
    return { config, client };
  }

  async store<T extends SecretPayload = SecretPayload>(
    name: SecretName,
    value: T,
    options: StoreSecretOptions = {},
    ...args: MaybeContextualArg<any>
  ): Promise<SecretReference> {
    const { log } = (await this.logCtx(args, "store", true)).for(this.store);
    log.verbose(`Storing secret ${name}`);

    try {
      validateSecretName(name);
    } catch (error) {
      throw this.parseError(error as Error);
    }

    const normalizedName = normalizeSecretName(name);
    const serialized = serializeSecretPayload(value);

    const parent = `projects/${this.config.projectId}`;

    const request = {
      parent,
      secretId: normalizedName,
      secret: {
        labels: options.tags,
        replication: {
          automatic: {},
        },
      },
    };

    let secretName: string;
    try {
      const [secret] = await this.client.createSecret(request);
      secretName = secret.name || "";
    } catch (error: any) {
      if (error?.message?.toLowerCase()?.includes?.("already")) {
        try {
          const [existingSecret] = await this.client.getSecret({
            name: `${parent}/secrets/${normalizedName}`,
          });
          secretName = existingSecret.name || "";
        } catch (getError) {
          throw this.parseError(getError as Error);
        }
      } else {
        throw this.parseError(error as Error);
      }
    }

    const payloadBuffer = Buffer.from(JSON.stringify(serialized), "utf8");
    const versionRequest = {
      parent: secretName,
      payload: {
        data: payloadBuffer,
      },
    };

    try {
      const [version] = await this.client.addSecretVersion(versionRequest);
      return {
        provider: this.provider,
        name: normalizedName,
        version: version?.name?.split("/").pop(),
      };
    } catch (error) {
      throw this.parseError(error as Error);
    }
  }

  async retrieve<T extends SecretPayload = SecretPayload>(
    nameOrRef: SecretName | SecretReference,
    ...args: MaybeContextualArg<any>
  ): Promise<T> {
    const { log } = (await this.logCtx(args, "retrieve", true)).for(this.retrieve);
    const nameStr = typeof nameOrRef === "string" ? nameOrRef : nameOrRef.name;
    log.verbose(`Retrieving secret ${nameStr}`);

    let name: string;

    if (typeof nameOrRef === "string") {
      name = nameOrRef;
    } else {
      name = nameOrRef.name;
    }

    try {
      validateSecretName(name);
    } catch (error) {
      throw this.parseError(error as Error);
    }

    const normalizedName = normalizeSecretName(name);
    const parent = `projects/${this.config.projectId}`;
    const secretPath = `${parent}/secrets/${normalizedName}`;

    try {
      const [secret] = await this.client.getSecret({
        name: secretPath,
      });
      if (!secret?.name) {
        throw this.parseError(
          new Error(`Secret "${normalizedName}" not found`)
        );
      }

      const secretVersionPath = `${secret.name}/versions/latest`;

      const [accessResponse] = await this.client.accessSecretVersion({
        name: secretVersionPath,
      });

      if (!accessResponse?.payload?.data) {
        throw this.parseError(
          new Error(`No secret value found for "${normalizedName}"`)
        );
      }

      const payload = JSON.parse(
        Buffer.from(accessResponse.payload.data).toString("utf8")
      ) as SerializedSecretPayload;

      return deserializeSecretPayload(payload) as T;
    } catch (error) {
      throw this.parseError(error as Error);
    }
  }

  async delete(
    nameOrRef: SecretName | SecretReference,
    ...args: MaybeContextualArg<any>
  ): Promise<void> {
    const { log } = (await this.logCtx(args, "delete", true)).for(this.delete);
    const nameStr = typeof nameOrRef === "string" ? nameOrRef : nameOrRef.name;
    log.verbose(`Deleting secret ${nameStr}`);

    let name: string;

    if (typeof nameOrRef === "string") {
      name = nameOrRef;
    } else {
      name = nameOrRef.name;
    }

    try {
      validateSecretName(name);
    } catch (error) {
      throw this.parseError(error as Error);
    }

    const normalizedName = normalizeSecretName(name);
    const parent = `projects/${this.config.projectId}`;
    const secretPath = `${parent}/secrets/${normalizedName}`;

    try {
      await this.client.deleteSecret({ name: secretPath });
    } catch (error) {
      throw this.parseError(error as Error);
    }
  }

  async exists(
    nameOrRef: SecretName | SecretReference,
    ...args: MaybeContextualArg<any>
  ): Promise<boolean> {
    const { log } = (await this.logCtx(args, "exists", true)).for(this.exists);
    const nameStr = typeof nameOrRef === "string" ? nameOrRef : nameOrRef.name;
    log.verbose(`Checking if secret ${nameStr} exists`);

    let name: string;

    if (typeof nameOrRef === "string") {
      name = nameOrRef;
    } else {
      name = nameOrRef.name;
    }

    try {
      validateSecretName(name);
    } catch (error) {
      throw this.parseError(error as Error);
    }

    const normalizedName = normalizeSecretName(name);
    const parent = `projects/${this.config.projectId}`;

    try {
      await this.client.getSecret({
        name: `${parent}/secrets/${normalizedName}`,
      });
      return true;
    } catch (error: any) {
      if (
        error?.code === 5 ||
        error?.message?.toLowerCase()?.includes?.("not found") ||
        error?.message?.includes?.("404")
      ) {
        return false;
      }
      throw this.parseError(error as Error);
    }
  }

  async list(options: ListSecretsOptions = {}, ...args: MaybeContextualArg<any>): Promise<SecretMetadata[]> {
    const { log } = (await this.logCtx(args, "list", true)).for(this.list);
    log.verbose("Listing secrets");

    const result: SecretMetadata[] = [];
    const parent = `projects/${this.config.projectId}`;

    const [secrets] = await this.client.listSecrets({
      parent,
      pageSize: options.limit ?? 50,
    });

    for (const secret of secrets || []) {
      if (!secret.name) {
        continue;
      }
      const nameParts = secret.name.split("/");
      const name = nameParts[nameParts.length - 1];

      result.push({
        provider: this.provider,
        name: name,
      });
    }

    return result;
  }

  async metadata(
    nameOrRef: SecretName | SecretReference,
    ...args: MaybeContextualArg<any>
  ): Promise<SecretMetadata | undefined> {
    const { log } = (await this.logCtx(args, "metadata", true)).for(this.metadata);
    const nameStr = typeof nameOrRef === "string" ? nameOrRef : nameOrRef.name;
    log.verbose(`Getting metadata for secret ${nameStr}`);

    let name: string;

    if (typeof nameOrRef === "string") {
      name = nameOrRef;
    } else {
      name = nameOrRef.name;
    }

    try {
      validateSecretName(name);
    } catch (error) {
      throw this.parseError(error as Error);
    }

    const normalizedName = normalizeSecretName(name);
    const parent = `projects/${this.config.projectId}`;

    try {
      const [secret] = await this.client.getSecret({
        name: `${parent}/secrets/${normalizedName}`,
      });

      if (!secret?.name) {
        return undefined;
      }
      const nameParts = secret.name.split("/");
      const resolvedName = nameParts[nameParts.length - 1];

      return {
        provider: this.provider,
        name: resolvedName,
      };
    } catch (error: any) {
      if (
        error?.code === 5 ||
        error?.message?.toLowerCase()?.includes?.("not found") ||
        error?.message?.includes?.("404")
      ) {
        return undefined;
      }
      throw this.parseError(error as Error);
    }
  }

  protected parseError(error: unknown): Error {
    const err = error as Error;
    const message = err.message || err.name || "Unknown error";
    const lowerMessage = message.toLowerCase();

    if (
      (error as any)?.code === 5 ||
      lowerMessage.includes("not found") ||
      lowerMessage.includes("404")
    ) {
      return new NotFoundError(message);
    }

    if (
      (error as any)?.code === 6 ||
      lowerMessage.includes("already exists") ||
      lowerMessage.includes("conflict") ||
      lowerMessage.includes("409")
    ) {
      return new ConflictError(message);
    }

    if (lowerMessage.includes("disabled") || lowerMessage.includes("403")) {
      return new NotFoundError(message);
    }

    if (lowerMessage.includes("unauthorized") || lowerMessage.includes("401")) {
      return new NotFoundError(message);
    }

    if (lowerMessage.includes("permission") || lowerMessage.includes("403")) {
      return new NotFoundError(message);
    }

    if (lowerMessage.includes("rate limit") || lowerMessage.includes("429")) {
      return new BadRequestError(message);
    }

    if (
      lowerMessage.includes("provider") ||
      lowerMessage.includes("unavailable") ||
      lowerMessage.includes("connection") ||
      lowerMessage.includes("timeout")
    ) {
      return new InternalError(message);
    }

    return new InternalError(message);
  }
}
