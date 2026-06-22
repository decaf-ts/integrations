import { SecretProvider } from "../../secrets/core";
import {
  SecretName,
  SecretPayload,
  SecretReference,
  SecretMetadata,
} from "../../secrets/core";
import { StoreSecretOptions, ListSecretsOptions } from "../../secrets/core";
import { validateSecretName, normalizeSecretName } from "../../secrets/core";
import {
  serializeSecretPayload,
  deserializeSecretPayload,
  type SerializedSecretPayload,
} from "../../secrets/core";
import { ClientBasedService, type MaybeContextualArg } from "@decaf-ts/core";
import { VaultSecretServiceConfig } from "./VaultSecretServiceConfig";
import {
  BadRequestError,
  ConflictError,
  InternalError,
  NotFoundError,
} from "@decaf-ts/db-decorators";

export class VaultKvV2Client {
  private baseUrl: string;
  private token: string;
  private mountPath: string;
  private namespace?: string;

  constructor(config: {
    baseUrl: string;
    token: string;
    mountPath: string;
    namespace?: string;
  }) {
    this.baseUrl = config.baseUrl.replace(/\/+$/, "");
    this.token = config.token;
    this.mountPath = config.mountPath.replace(/^\/+/, "").replace(/\/+$/, "");
    this.namespace = config.namespace;
  }

  private async request<T = any>(
    method: string,
    path: string,
    body?: any
  ): Promise<T> {
    const url = `${this.baseUrl}/v1/${path}`;
    const headers: Record<string, string> = {
      "X-Vault-Token": this.token,
      "Content-Type": "application/json",
    };

    if (this.namespace) {
      headers["X-Vault-Namespace"] = this.namespace;
    }

    const response = await fetch(url, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });

    if (!response.ok) {
      const errorData = (await response
        .json()
        .catch(() => ({ errors: [] }))) as { errors?: string[] };
      const message = errorData.errors?.join(", ") || response.statusText;
      const err = new Error(message);
      err.name = `VaultError`;
      throw err;
    }

    if (response.status === 204) {
      return undefined as T;
    }

    const text = await response.text();
    if (!text) {
      return undefined as T;
    }

    const data = JSON.parse(text) as { data?: T };
    return data.data as T;
  }

  async read(path: string): Promise<any> {
    return this.request<any>("GET", `${this.mountPath}/data/${path}`);
  }

  async write(path: string, data: any): Promise<void> {
    await this.request<void>("POST", `${this.mountPath}/data/${path}`, {
      data,
    });
  }

  async delete(path: string): Promise<void> {
    await this.request<void>("DELETE", `${this.mountPath}/data/${path}`);
  }

  async list(path: string): Promise<string[]> {
    const result = await this.request<{ keys: string[] }>(
      "LIST",
      `${this.mountPath}/metadata/${path}`
    );
    return result.keys || [];
  }

  async metadata(path: string): Promise<any> {
    return this.request<any>("GET", `${this.mountPath}/metadata/${path}`);
  }
}

export class VaultSecretService extends ClientBasedService<
  VaultKvV2Client,
  VaultSecretServiceConfig
> {
  readonly provider: SecretProvider = "hashicorp-vault";

  async initialize(
    ...args: MaybeContextualArg<any>
  ): Promise<{ config: VaultSecretServiceConfig; client: VaultKvV2Client }> {
    const { ctxArgs } = (await this.logCtx(args, "initialize", true)).for(
      this.initialize
    );
    const config = ctxArgs[0] as VaultSecretServiceConfig;
    const client = new VaultKvV2Client({
      baseUrl: config.address,
      token: config.token,
      mountPath: config.path,
      namespace: config.namespace,
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

    try {
      await this.client.write(normalizedName, {
        value: serialized.value,
        encoding: serialized.encoding,
        contentType: options.contentType,
        tags: options.tags,
      });

      return {
        provider: this.provider,
        name: normalizedName,
        version: options.version,
      };
    } catch (error: any) {
      if (
        error?.name?.toLowerCase().includes("already") ||
        error?.message?.toLowerCase()?.includes("already")
      ) {
        throw new ConflictError(`Secret "${normalizedName}" already exists`);
      }
      throw this.parseError(error as Error);
    }
  }

  async retrieve<T extends SecretPayload = SecretPayload>(
    nameOrRef: SecretName | SecretReference,
    ...args: MaybeContextualArg<any>
  ): Promise<T> {
    const { log } = (await this.logCtx(args, "retrieve", true)).for(
      this.retrieve
    );
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

    try {
      const response = await this.client.read(normalizedName);

      if (!response?.data?.value) {
        throw new NotFoundError(`Secret "${normalizedName}" has no value`);
      }

      const payload: SerializedSecretPayload = {
        encoding: response.data.encoding ?? "utf8",
        value: response.data.value,
      };

      return deserializeSecretPayload(payload) as T;
    } catch (error: any) {
      if (
        error?.name?.toLowerCase().includes("not found") ||
        error?.message?.toLowerCase()?.includes("not found")
      ) {
        throw new NotFoundError(`Secret "${normalizedName}" not found`);
      }
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

    try {
      await this.client.delete(normalizedName);
    } catch (error: any) {
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

    try {
      await this.client.read(normalizedName);
      return true;
    } catch (error: any) {
      if (
        error?.name?.toLowerCase().includes("not found") ||
        error?.message?.toLowerCase()?.includes("not found")
      ) {
        return false;
      }
      throw this.parseError(error as Error);
    }
  }

  async list(
    options: ListSecretsOptions = {},
    ...args: MaybeContextualArg<any>
  ): Promise<SecretMetadata[]> {
    const { log } = (await this.logCtx(args, "list", true)).for(this.list);
    log.verbose("Listing secrets");
    const result: SecretMetadata[] = [];

    try {
      const keys = await this.client.list("");

      for (const key of keys) {
        if (options.limit && result.length >= options.limit) {
          break;
        }

        const meta = await this.client.metadata(key);

        if (meta) {
          result.push({
            provider: this.provider,
            name: key,
            createdAt: meta.created_time
              ? new Date(meta.created_time)
              : undefined,
            updatedAt: meta.updated_time
              ? new Date(meta.updated_time)
              : undefined,
            enabled: true,
            tags: meta.custom_metadata ?? undefined,
          });
        }
      }
    } catch (error: any) {
      throw this.parseError(error as Error);
    }

    return result;
  }

  async metadata(
    nameOrRef: SecretName | SecretReference,
    ...args: MaybeContextualArg<any>
  ): Promise<SecretMetadata | undefined> {
    const { log } = (await this.logCtx(args, "metadata", true)).for(
      this.metadata
    );
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

    try {
      const meta = await this.client.metadata(normalizedName);

      if (!meta) {
        return undefined;
      }

      const result: SecretMetadata = {
        provider: this.provider,
        name: normalizedName,
        createdAt: meta.created_time ? new Date(meta.created_time) : undefined,
        updatedAt: meta.updated_time ? new Date(meta.updated_time) : undefined,
        enabled: true,
        tags: meta.custom_metadata ?? undefined,
      };

      return result;
    } catch (error: any) {
      if (
        error?.name?.toLowerCase().includes("not found") ||
        error?.message?.toLowerCase()?.includes("not found")
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

    if (lowerMessage.includes("not found") || lowerMessage.includes("404")) {
      return new NotFoundError(message);
    }

    if (
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
