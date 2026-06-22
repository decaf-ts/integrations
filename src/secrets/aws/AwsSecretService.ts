import {
  SecretsManagerClient,
  GetSecretValueCommand,
  GetSecretValueCommandInput,
  PutSecretValueCommand,
  PutSecretValueCommandInput,
  DeleteSecretCommand,
  DeleteSecretCommandInput,
  ListSecretsCommand,
  ListSecretsCommandInput,
  DescribeSecretCommand,
  DescribeSecretCommandInput,
} from "@aws-sdk/client-secrets-manager";
import {
  AuthorizationError,
  ClientBasedService,
  type ContextualArgs,
  type MaybeContextualArg,
} from "@decaf-ts/core";
import {
  SecretName,
  SecretPayload,
  SecretReference,
  SecretMetadata,
} from "../../secrets/core";
import {
  StoreSecretOptions,
  RetrieveSecretOptions,
  DeleteSecretOptions,
} from "../../secrets/core";
import {
  ExistsSecretOptions,
  ListSecretsOptions,
  SecretMetadataOptions,
} from "../../secrets/core";
import { validateSecretName, normalizeSecretName } from "../../secrets/core";
import {
  serializeSecretPayload,
  deserializeSecretPayload,
  type SerializedSecretPayload,
} from "../../secrets/core";
import { AwsSecretServiceConfig } from "./AwsSecretServiceConfig";
import {
  BadRequestError,
  ConflictError,
  InternalError,
  NotFoundError,
} from "@decaf-ts/db-decorators";

export class AwsSecretService extends ClientBasedService<
  SecretsManagerClient,
  AwsSecretServiceConfig
> {
  get provider(): SecretProvider {
    return "aws-secrets-manager";
  }

  async initialize(
    ...args: ContextualArgs<any>
  ): Promise<{ config: AwsSecretServiceConfig; client: SecretsManagerClient }> {
    const config = args[0] as AwsSecretServiceConfig;
    if (!config) {
      throw new Error("Missing configuration for AwsSecretService");
    }
    const client = new SecretsManagerClient({
      region: config.region,
      credentials: config.credentials,
      endpoint: config.endpoint,
    });
    return { config, client };
  }

  async store<T extends SecretPayload = SecretPayload>(
    name: SecretName,
    value: T,
    options: StoreSecretOptions = {},
    ...args: MaybeContextualArg<any>
  ): Promise<SecretReference> {
    const { log, ctxArgs } = (await this.logCtx(args, "store", true)).for(
      this.store
    );
    log.verbose(`Storing secret ${name}`);

    try {
      validateSecretName(name);
    } catch (error) {
      throw this.parseError(error as Error);
    }

    const normalizedName = normalizeSecretName(name);
    const serialized = serializeSecretPayload(value);

    const input: PutSecretValueCommandInput = {
      SecretId: normalizedName,
      SecretString: serialized.value,
    };

    try {
      await this.client.send(new PutSecretValueCommand(input));
    } catch (error) {
      throw this.parseError(error as Error);
    }

    return {
      provider: this.provider,
      name: normalizedName,
      version: options.version,
    };
  }

  async retrieve<T extends SecretPayload = SecretPayload>(
    nameOrRef: SecretName | SecretReference,
    options: RetrieveSecretOptions = {},
    ...args: MaybeContextualArg<any>
  ): Promise<T> {
    const { log, ctxArgs } = (await this.logCtx(args, "retrieve", true)).for(
      this.retrieve
    );
    const nameStr = typeof nameOrRef === "string" ? nameOrRef : nameOrRef.name;
    log.verbose(`Retrieving secret ${nameStr}`);

    let name: string;
    let versionStage: string | undefined;

    if (typeof nameOrRef === "string") {
      name = nameOrRef;
      versionStage = options.version;
    } else {
      name = nameOrRef.name;
      versionStage = nameOrRef.version;
    }

    try {
      validateSecretName(name);
    } catch (error) {
      throw this.parseError(error as Error);
    }

    const normalizedName = normalizeSecretName(name);

    const input: GetSecretValueCommandInput = {
      SecretId: normalizedName,
    };

    if (versionStage) {
      input.VersionStage = versionStage;
    }

    let secretValue: string;
    try {
      const response = await this.client.send(new GetSecretValueCommand(input));
      if (response.SecretString !== undefined) {
        secretValue = response.SecretString;
      } else if (response.SecretBinary !== undefined) {
        secretValue = Buffer.from(response.SecretBinary).toString("base64");
      } else {
        throw this.parseError(
          new Error(`No secret value found for "${normalizedName}"`)
        );
      }
    } catch (error) {
      throw this.parseError(error as Error);
    }

    const payload: SerializedSecretPayload = {
      encoding: "utf8",
      value: secretValue,
    };

    return deserializeSecretPayload(payload) as T;
  }

  async delete(
    nameOrRef: SecretName | SecretReference,
    options: DeleteSecretOptions = {},
    ...args: MaybeContextualArg<any>
  ): Promise<void> {
    const { log, ctxArgs } = (await this.logCtx(args, "delete", true)).for(
      this.delete
    );
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

    const input: DeleteSecretCommandInput = {
      SecretId: normalizedName,
      ForceDeleteWithoutRecovery: options.force ?? false,
    };

    try {
      await this.client.send(new DeleteSecretCommand(input));
    } catch (error) {
      throw this.parseError(error as Error);
    }
  }

  async exists(
    nameOrRef: SecretName | SecretReference,
    options: ExistsSecretOptions = {},
    ...args: MaybeContextualArg<any>
  ): Promise<boolean> {
    const { log, ctxArgs } = (await this.logCtx(args, "exists", true)).for(
      this.exists
    );
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

    const input: DescribeSecretCommandInput = {
      SecretId: normalizedName,
    };

    try {
      await this.client.send(new DescribeSecretCommand(input));
      return true;
    } catch (error) {
      const err = error as Error;
      if (
        err.message.toLowerCase().includes("not found") ||
        err.message.includes("404")
      ) {
        return false;
      }
      throw this.parseError(err);
    }
  }

  async list(
    options: ListSecretsOptions = {},
    ...args: MaybeContextualArg<any>
  ): Promise<SecretMetadata[]> {
    const { log, ctxArgs } = (await this.logCtx(args, "list", true)).for(
      this.list
    );
    log.verbose("Listing secrets");

    const result: SecretMetadata[] = [];

    let nextToken: string | undefined;

    do {
      const input: ListSecretsCommandInput = {
        NextToken: nextToken,
        MaxResults: options.limit ?? 50,
      };

      try {
        const response = await this.client.send(new ListSecretsCommand(input));
        nextToken = response.NextToken;

        if (response.SecretList) {
          for (const secret of response.SecretList) {
            if (secret.Name) {
              result.push({
                provider: this.provider,
                name: secret.Name,
                version: secret.LastChangedDate ? undefined : undefined,
                createdAt: secret.CreatedDate,
                updatedAt: secret.LastChangedDate,
                enabled: true,
                tags: secret.Tags?.reduce<Record<string, string>>(
                  (
                    acc: Record<string, string>,
                    tag: { Key?: string; Value?: string }
                  ) => {
                    if (tag.Key && tag.Value) {
                      acc[tag.Key] = tag.Value;
                    }
                    return acc;
                  },
                  {}
                ),
              });
            }
          }
        }
      } catch (error) {
        throw this.parseError(error as Error);
      }
    } while (nextToken);

    return result;
  }

  async metadata(
    nameOrRef: SecretName | SecretReference,
    options: SecretMetadataOptions = {},
    ...args: MaybeContextualArg<any>
  ): Promise<SecretMetadata | undefined> {
    const { log, ctxArgs } = (await this.logCtx(args, "metadata", true)).for(
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

    const input: DescribeSecretCommandInput = {
      SecretId: normalizedName,
    };

    try {
      const response = await this.client.send(new DescribeSecretCommand(input));

      if (!response.Name) {
        return undefined;
      }

      const meta: SecretMetadata = {
        provider: this.provider,
        name: response.Name,
        createdAt: response.CreatedDate,
        updatedAt: response.LastChangedDate,
        enabled: true,
        tags: response.Tags?.reduce<Record<string, string>>(
          (
            acc: Record<string, string>,
            tag: { Key?: string; Value?: string }
          ) => {
            if (tag.Key && tag.Value) {
              acc[tag.Key] = tag.Value;
            }
            return acc;
          },
          {}
        ),
      };

      if (options.includeTags) {
        meta.tags = meta.tags;
      }

      return meta;
    } catch (error) {
      const err = error as Error;
      if (
        err.message.toLowerCase().includes("not found") ||
        err.message.includes("404")
      ) {
        return undefined;
      }
      throw this.parseError(err);
    }
  }

  protected parseError(error: unknown): Error {
    const err = error as Error;
    const message = err.message || err.name || "Unknown error";
    const lowerMessage = message.toLowerCase();

    if (lowerMessage.includes("not found") || lowerMessage.includes("404")) {
      return new NotFoundError(err);
    }

    if (
      lowerMessage.includes("already exists") ||
      lowerMessage.includes("conflict") ||
      lowerMessage.includes("409")
    ) {
      return new ConflictError(err);
    }

    if (lowerMessage.includes("disabled") || lowerMessage.includes("403")) {
      return new NotFoundError(err);
    }

    if (lowerMessage.includes("unauthorized") || lowerMessage.includes("401")) {
      return new NotFoundError(err);
    }

    if (lowerMessage.includes("permission") || lowerMessage.includes("403")) {
      return new AuthorizationError(err);
    }

    if (lowerMessage.includes("rate limit") || lowerMessage.includes("429")) {
      return new BadRequestError(err);
    }

    if (
      lowerMessage.includes("provider") ||
      lowerMessage.includes("unavailable") ||
      lowerMessage.includes("connection") ||
      lowerMessage.includes("timeout")
    ) {
      return new InternalError(err);
    }

    return new InternalError(err);
  }
}
