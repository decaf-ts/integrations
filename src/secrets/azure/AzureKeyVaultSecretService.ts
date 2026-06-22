import { SecretClient } from "@azure/keyvault-secrets";
import { DefaultAzureCredential } from "@azure/identity";
import { SecretProvider } from "../../secrets/core";
import { ClientBasedService, type ContextualArgs, type MaybeContextualArg } from "@decaf-ts/core";
import type { SecretServiceConfig } from "../../secrets/core";
import { SecretName, SecretPayload, SecretReference, SecretMetadata } from "../../secrets/core";
import { StoreSecretOptions, RetrieveSecretOptions, DeleteSecretOptions } from "../../secrets/core";
import { ExistsSecretOptions, ListSecretsOptions, SecretMetadataOptions } from "../../secrets/core";
import { validateSecretName, normalizeSecretName } from "../../secrets/core";
import { serializeSecretPayload, deserializeSecretPayload, type SerializedSecretPayload } from "../../secrets/core";
import { AzureKeyVaultSecretServiceConfig } from "./AzureKeyVaultSecretServiceConfig";
import {
  BadRequestError,
  ConflictError,
  InternalError,
  NotFoundError,
} from "@decaf-ts/db-decorators";

export class AzureKeyVaultSecretService extends ClientBasedService<SecretClient, AzureKeyVaultSecretServiceConfig> {
  readonly provider: SecretProvider = "azure-key-vault";

  async initialize(...args: ContextualArgs<any>): Promise<{ config: AzureKeyVaultSecretServiceConfig; client: SecretClient }> {
    const config = args[0] as AzureKeyVaultSecretServiceConfig;
    const client = new SecretClient(
      config.vaultUrl,
      config.credentials || new DefaultAzureCredential()
    );
    return { config, client };
  }

  async store<T extends SecretPayload = SecretPayload>(
    name: SecretName,
    value: T,
    options: StoreSecretOptions = {},
    ...args: MaybeContextualArg<any>
  ): Promise<SecretReference> {
    const { log, ctxArgs } = (await this.logCtx(args, "store", true)).for(this.store);
    log.verbose(`Storing secret ${name}`);
    
    try {
      validateSecretName(name);
    } catch (error) {
      throw this.parseError(error as Error);
    }

    const normalizedName = normalizeSecretName(name);
    const serialized = serializeSecretPayload(value);

    try {
      const result = await this.client.setSecret(normalizedName, serialized.value);

      return {
        provider: this.provider,
        name: normalizedName,
        version: result.properties.version,
        metadata: {},
      };
    } catch (error) {
      throw this.parseError(error as Error);
    }
  }

  async retrieve<T extends SecretPayload = SecretPayload>(
    nameOrRef: SecretName | SecretReference,
    options: RetrieveSecretOptions = {},
    ...args: MaybeContextualArg<any>
  ): Promise<T> {
    const { log, ctxArgs } = (await this.logCtx(args, "retrieve", true)).for(this.retrieve);
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
      const result = await this.client.getSecret(normalizedName);
      if (result.value === undefined) {
        throw this.parseError(
          new Error(`Secret "${normalizedName}" has no value`)
        );
      }
      const payload: SerializedSecretPayload = {
        encoding: "utf8",
        value: result.value,
      };
      return deserializeSecretPayload(payload) as T;
    } catch (error) {
      throw this.parseError(error as Error);
    }
  }

  async delete(
    nameOrRef: SecretName | SecretReference,
    options: DeleteSecretOptions = {},
    ...args: MaybeContextualArg<any>
  ): Promise<void> {
    const { log, ctxArgs } = (await this.logCtx(args, "delete", true)).for(this.delete);
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
      if (options.force) {
        await this.client.beginDeleteSecret(normalizedName);
      } else {
        // For soft-delete, just beginDelete which allows recovery
        await this.client.beginDeleteSecret(normalizedName);
      }
    } catch (error) {
      throw this.parseError(error as Error);
    }
  }

  async exists(
    nameOrRef: SecretName | SecretReference,
    options: ExistsSecretOptions = {},
    ...args: MaybeContextualArg<any>
  ): Promise<boolean> {
    const { log, ctxArgs } = (await this.logCtx(args, "exists", true)).for(this.exists);
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
      await this.client.getSecret(normalizedName);
      return true;
    } catch (error) {
      const err = error as Error;
      if (err.message.toLowerCase().includes("not found") || err.message.includes("404")) {
        return false;
      }
      throw this.parseError(err);
    }
  }

  async list(options: ListSecretsOptions = {}, ...args: MaybeContextualArg<any>): Promise<SecretMetadata[]> {
    const { log, ctxArgs } = (await this.logCtx(args, "list", true)).for(this.list);
    log.verbose("Listing secrets");

    const result: SecretMetadata[] = [];
    const search = this.client.listPropertiesOfSecrets();

    let count = 0;
    const limit = options.limit ?? Infinity;
    const offset = options.offset ?? 0;

    for await (const secretProperties of search) {
      if (!secretProperties.name) {
        continue;
      }

      if (count < offset) {
        count++;
        continue;
      }

      if (result.length >= limit) {
        break;
      }

      result.push({
        provider: this.provider,
        name: secretProperties.name,
        version: secretProperties.version,
        createdAt: secretProperties.notBefore,
        updatedAt: secretProperties.expiresOn,
        enabled: secretProperties.enabled ?? true,
        uri: secretProperties.id,
      });

      count++;
    }

    return result;
  }

  async metadata(
    nameOrRef: SecretName | SecretReference,
    options: SecretMetadataOptions = {},
    ...args: MaybeContextualArg<any>
  ): Promise<SecretMetadata | undefined> {
    const { log, ctxArgs } = (await this.logCtx(args, "metadata", true)).for(this.metadata);
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
      const result = await this.client.getSecret(normalizedName);
      return {
        provider: this.provider,
        name: result.name,
        version: result.properties.version,
        createdAt: result.properties.notBefore,
        updatedAt: result.properties.expiresOn,
        enabled: result.properties.enabled ?? true,
        uri: result.properties.id,
      };
    } catch (error) {
      const err = error as Error;
      if (err.message.toLowerCase().includes("not found") || err.message.includes("404")) {
        return undefined;
      }
      throw this.parseError(err);
    }
  }

  protected parseError(error: unknown): Error {
    const err = error as Error;
    const message = err.message || err.name || "Unknown error";
    const operation = "Azure Key Vault";
    const lowerMessage = message.toLowerCase();

    if (lowerMessage.includes("not found") || lowerMessage.includes("404")) {
      return new NotFoundError(message, err);
    }

    if (
      lowerMessage.includes("already exists") ||
      lowerMessage.includes("conflict") ||
      lowerMessage.includes("409")
    ) {
      return new ConflictError(message, err);
    }

    if (lowerMessage.includes("disabled") || lowerMessage.includes("403")) {
      return new NotFoundError(message, err);
    }

    if (lowerMessage.includes("unauthorized") || lowerMessage.includes("401")) {
      return new NotFoundError(message, err);
    }

    if (lowerMessage.includes("permission") || lowerMessage.includes("403")) {
      return new NotFoundError(message, err);
    }

    if (lowerMessage.includes("rate limit") || lowerMessage.includes("429")) {
      return new BadRequestError(message, err);
    }

    if (
      lowerMessage.includes("provider") ||
      lowerMessage.includes("unavailable") ||
      lowerMessage.includes("connection") ||
      lowerMessage.includes("timeout")
    ) {
      return new InternalError(message, err);
    }

    return new InternalError(message, err);
  }
}
