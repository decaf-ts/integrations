import { SecretError, SecretProvider } from "../../secrets/core";
import { SecretName, SecretPayload, SecretReference, SecretMetadata } from "../../secrets/core";
import { validateSecretName, normalizeSecretName } from "../../secrets/core";
import { serializeSecretPayload, deserializeSecretPayload, type SerializedSecretPayload } from "../../secrets/core";
import { ClientBasedService, type ContextualArgs, type MaybeContextualArg } from "@decaf-ts/core";
import { OnePasswordSecretServiceConfig } from "./OnePasswordSecretServiceConfig";

export class OnePasswordSecretService extends ClientBasedService<unknown, OnePasswordSecretServiceConfig> {
  readonly provider: SecretProvider = "1password";

  async initialize(...args: ContextualArgs<any>): Promise<{ config: OnePasswordSecretServiceConfig; client: unknown }> {
    const config = args[0] as OnePasswordSecretServiceConfig;
    if (!config.connectHost) {
      throw new Error("1Password service requires connectHost configuration");
    }
    return { config, client: {} };
  }

  async store<T extends SecretPayload = SecretPayload>(
    name: SecretName,
    value: T,
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
    const vaultId = this.config.vaultId;

    if (!vaultId) {
      throw this.parseError(
        new Error("1Password provider requires a vault ID in configuration")
      );
    }

    const item = {
      title: normalizedName,
      category: "login",
      fields: [
        {
          label: "secret",
          value: serialized.value,
          purpose: "password",
        },
      ],
      notes: `Created by DECAF Secret Service at ${new Date().toISOString()}`,
    };

    try {
      const response = await this.postRequest(`/v1/vaults/${vaultId}/items`, item);

      if (!response.id) {
        throw new SecretError(
          "SECRET_PROVIDER_CONFLICT",
          "Failed to store secret: No item ID returned"
        );
      }

      return {
        provider: this.provider,
        name: normalizedName,
        version: undefined,
        metadata: {
          id: response.id,
        },
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
    const vaultId = this.config.vaultId;

    if (!vaultId) {
      throw this.parseError(
        new Error("1Password provider requires a vault ID in configuration")
      );
    }

    let itemId: string | undefined;

    if (this.config.itemIdTemplate && this.config.itemIdTemplate.includes("${name}")) {
      itemId = this.config.itemIdTemplate.replace("${name}", normalizedName);
    } else {
      const items = await this.getItemsByTitle(normalizedName, vaultId);
      if (items.length === 0) {
        throw this.parseError(
          new Error(`Secret "${normalizedName}" not found in vault`)
        );
      }
      itemId = items[0].id;
    }

    try {
      const item = await this.getRequest(`/v1/vaults/${vaultId}/items/${itemId}`);

      let value = "";
      if (item.fields && Array.isArray(item.fields)) {
        const secretField = item.fields.find((f: any) => f.purpose === "password" || f.label === "secret");
        if (secretField && secretField.value !== undefined) {
          value = secretField.value;
        }
      }

      if (!value && item.details && item.details.fields) {
        const fields = Array.isArray(item.details.fields) ? item.details.fields : [];
        const secretField = fields.find((f: any) => f.purpose === "password" || f.label === "secret");
        if (secretField && secretField.value !== undefined) {
          value = secretField.value;
        }
      }

      if (!value) {
        throw new SecretError(
          "SECRET_NOT_FOUND",
          `No secret value found for item "${itemId}"`
        );
      }

      const payload: SerializedSecretPayload = {
        encoding: "utf8",
        value,
      };

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
    const vaultId = this.config.vaultId;

    if (!vaultId) {
      throw this.parseError(
        new Error("1Password provider requires a vault ID in configuration")
      );
    }

    let itemId: string | undefined;

    if (this.config.itemIdTemplate && this.config.itemIdTemplate.includes("${name}")) {
      itemId = this.config.itemIdTemplate.replace("${name}", normalizedName);
    } else {
      const items = await this.getItemsByTitle(normalizedName, vaultId);
      if (items.length === 0) {
        return;
      }
      itemId = items[0].id;
    }

    try {
      await this.deleteRequest(`/v1/vaults/${vaultId}/items/${itemId}`);
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
    const vaultId = this.config.vaultId;

    if (!vaultId) {
      throw this.parseError(
        new Error("1Password provider requires a vault ID in configuration")
      );
    }

    let itemId: string | undefined;

    if (this.config.itemIdTemplate && this.config.itemIdTemplate.includes("${name}")) {
      itemId = this.config.itemIdTemplate.replace("${name}", normalizedName);
    } else {
      const items = await this.getItemsByTitle(normalizedName, vaultId);
      if (items.length === 0) {
        return false;
      }
      itemId = items[0].id;
    }

    try {
      await this.getRequest(`/v1/vaults/${vaultId}/items/${itemId}`);
      return true;
    } catch (error) {
      const err = error as Error;
      if (err.message.toLowerCase().includes("not found") || err.message.includes("404")) {
        return false;
      }
      throw this.parseError(err);
    }
  }

  async list(...args: MaybeContextualArg<any>): Promise<SecretMetadata[]> {
    const { log } = (await this.logCtx(args, "list", true)).for(this.list);
    log.verbose("Listing secrets");
    const result: SecretMetadata[] = [];
    const vaultId = this.config.vaultId;

    if (!vaultId) {
      return result;
    }

    try {
      const items = await this.getRequest(`/v1/vaults/${vaultId}/items`);

      for (const item of Array.isArray(items) ? items : [items]) {
        if (item.id && item.title) {
          result.push({
            provider: this.provider,
            name: item.title,
            version: undefined,
            createdAt: item.createdAt ? new Date(item.createdAt) : undefined,
            updatedAt: item.updatedAt ? new Date(item.updatedAt) : undefined,
            enabled: true,
            externalId: item.id,
            tags: item.category ? { category: item.category } : undefined,
          });
        }
      }

      return result;
    } catch (error) {
      throw this.parseError(error as Error);
    }
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
    const vaultId = this.config.vaultId;

    if (!vaultId) {
      throw this.parseError(
        new Error("1Password provider requires a vault ID in configuration")
      );
    }

    let itemId: string | undefined;

    if (this.config.itemIdTemplate && this.config.itemIdTemplate.includes("${name}")) {
      itemId = this.config.itemIdTemplate.replace("${name}", normalizedName);
    } else {
      const items = await this.getItemsByTitle(normalizedName, vaultId);
      if (items.length === 0) {
        return undefined;
      }
      itemId = items[0].id;
    }

    try {
      const item = await this.getRequest(`/v1/vaults/${vaultId}/items/${itemId}`);

      const meta: SecretMetadata = {
        provider: this.provider,
        name: item.title || normalizedName,
        version: undefined,
        createdAt: item.createdAt ? new Date(item.createdAt) : undefined,
        updatedAt: item.updatedAt ? new Date(item.updatedAt) : undefined,
        enabled: true,
        externalId: item.id,
        tags: item.category ? { category: item.category } : undefined,
      };

      return meta;
    } catch (error) {
      const err = error as Error;
      if (err.message.toLowerCase().includes("not found") || err.message.includes("404")) {
        return undefined;
      }
      throw this.parseError(err);
    }
  }

  protected parseError(error: unknown): SecretError {
    const err = error as Error;
    const message = err.message || err.name || "Unknown error";
    const lowerMessage = message.toLowerCase();

    if (lowerMessage.includes("not found") || lowerMessage.includes("404")) {
      return new SecretError(
        "SECRET_NOT_FOUND",
        `Secret not found: ${message}`,
        err
      );
    }

    if (
      lowerMessage.includes("already exists") ||
      lowerMessage.includes("conflict") ||
      lowerMessage.includes("409")
    ) {
      return new SecretError(
        "SECRET_ALREADY_EXISTS",
        `Secret already exists: ${message}`,
        err
      );
    }

    if (lowerMessage.includes("unauthorized") || lowerMessage.includes("401")) {
      return new SecretError(
        "SECRET_PROVIDER_AUTH_FAILED",
        `Authentication failed: ${message}`,
        err
      );
    }

    if (lowerMessage.includes("permission") || lowerMessage.includes("403")) {
      return new SecretError(
        "SECRET_PROVIDER_PERMISSION_DENIED",
        `Permission denied: ${message}`,
        err
      );
    }

    if (lowerMessage.includes("rate limit") || lowerMessage.includes("429")) {
      return new SecretError(
        "SECRET_PROVIDER_RATE_LIMITED",
        `Rate limited: ${message}`,
        err
      );
    }

    if (lowerMessage.includes("provider") || lowerMessage.includes("unavailable") || lowerMessage.includes("connection") || lowerMessage.includes("timeout")) {
      return new SecretError(
        "SECRET_PROVIDER_UNAVAILABLE",
        `Provider unavailable: ${message}`,
        err
      );
    }

    return new SecretError(
      "SECRET_PROVIDER_CONFLICT",
      `Provider error: ${message}`,
      err
    );
  }

  private async getRequest(path: string): Promise<any> {
    const url = `${this.config.connectHost}${path}`;
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (this.config.connectToken) {
      headers["Authorization"] = `Bearer ${this.config.connectToken}`;
    }

    const response = await fetch(url, {
      method: "GET",
      headers,
    });

    if (!response.ok) {
      const errorBody = await response.text().catch(() => "");
      throw new Error(`1Password API error (${response.status}): ${errorBody || response.statusText}`);
    }

    return response.json();
  }

  private async postRequest(path: string, body: any): Promise<any> {
    const url = `${this.config.connectHost}${path}`;
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (this.config.connectToken) {
      headers["Authorization"] = `Bearer ${this.config.connectToken}`;
    }

    const response = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorBody = await response.text().catch(() => "");
      throw new Error(`1Password API error (${response.status}): ${errorBody || response.statusText}`);
    }

    return response.json();
  }

  private async deleteRequest(path: string): Promise<void> {
    const url = `${this.config.connectHost}${path}`;
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (this.config.connectToken) {
      headers["Authorization"] = `Bearer ${this.config.connectToken}`;
    }

    const response = await fetch(url, {
      method: "DELETE",
      headers,
    });

    if (!response.ok) {
      const errorBody = await response.text().catch(() => "");
      throw new Error(`1Password API error (${response.status}): ${errorBody || response.statusText}`);
    }
  }

  private async getItemsByTitle(title: string, vaultId: string): Promise<any[]> {
    try {
      const allItems = await this.getRequest(`/v1/vaults/${vaultId}/items`);
      const items = Array.isArray(allItems) ? allItems : [allItems];
      return items.filter((item) => item.title === title);
    } catch (error) {
      throw this.parseError(error as Error);
    }
  }
}
