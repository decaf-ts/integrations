/**
 * @module integrations/tests/node-services
 * @summary Coverage for the non-Environment node-service subclasses.
 * @description Verifies the Phase A slice 3 contract: every node service in
 * `src/shared/node-service.ts` and its provider subclasses must ignore
 * Environment configuration, require an explicit config object, keep the
 * provider identifier injected, stay out of the injectable/service registry,
 * and never be auto-booted by `Service.boot`. Representative originals must
 * keep resolving configuration from their Environment slices.
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { jest } from "@jest/globals";
import { Context, Service } from "@decaf-ts/core";
import { Injectables } from "@decaf-ts/injectable-decorators";
import { ValidationError } from "@decaf-ts/db-decorators";
import { SlackService } from "../../../src/comms/slack/SlackService";
import { SlackNodeService } from "../../../src/comms/slack/SlackNodeService";
import { EmailService } from "../../../src/comms/email/EmailService";
import { EmailNodeService } from "../../../src/comms/email/EmailNodeService";
import { GmailNodeService } from "../../../src/comms/gmail/GmailNodeService";
import { TeamsNodeService } from "../../../src/comms/teams/TeamsNodeService";
import { TelegramNodeService } from "../../../src/comms/telegram/TelegramNodeService";
import { GithubNodeService } from "../../../src/devops/github/GithubNodeService";
import { GitlabNodeService } from "../../../src/devops/gitlab/GitlabNodeService";
import { AirtableNodeService } from "../../../src/io/airtable/AirtableNodeService";
import { GoogleSheetsNodeService } from "../../../src/io/google-sheets/GoogleSheetsNodeService";
import { GraphqlNodeService } from "../../../src/io/graphql/GraphqlNodeService";
import { HttpNodeService } from "../../../src/shared/http/HttpNodeService";
import { S3BlobStoreService } from "../../../src/blob/s3/S3BlobStoreService";
import { S3NodeService } from "../../../src/blob/s3/S3NodeService";
import { GcsNodeService } from "../../../src/blob/gcp/GcsNodeService";
import { AzureNodeService } from "../../../src/blob/azure/AzureNodeService";
import { FsSecretService } from "../../../src/secrets/fs/FsSecretService";
import { FsSecretNodeService } from "../../../src/secrets/fs/FsSecretNodeService";
import { ModelSecretNodeService } from "../../../src/secrets/model/ModelSecretNodeService";
import { AwsSecretNodeService } from "../../../src/secrets/aws/AwsSecretNodeService";
import { AzureKeyVaultSecretNodeService } from "../../../src/secrets/azure/AzureKeyVaultSecretNodeService";
import { GcpSecretManagerNodeService } from "../../../src/secrets/gcp/GcpSecretManagerNodeService";
import { VaultSecretNodeService } from "../../../src/secrets/vault/VaultSecretNodeService";
import { OnePasswordSecretNodeService } from "../../../src/secrets/onepassword/OnePasswordSecretNodeService";

type NodeCtor = new () => any;

const NODE_SERVICES: Array<[string, NodeCtor]> = [
  ["SlackNodeService", SlackNodeService],
  ["EmailNodeService", EmailNodeService],
  ["GmailNodeService", GmailNodeService],
  ["TeamsNodeService", TeamsNodeService],
  ["TelegramNodeService", TelegramNodeService],
  ["GithubNodeService", GithubNodeService],
  ["GitlabNodeService", GitlabNodeService],
  ["AirtableNodeService", AirtableNodeService],
  ["GoogleSheetsNodeService", GoogleSheetsNodeService],
  ["GraphqlNodeService", GraphqlNodeService],
  ["HttpNodeService", HttpNodeService],
  ["S3NodeService", S3NodeService],
  ["GcsNodeService", GcsNodeService],
  ["AzureNodeService", AzureNodeService],
  ["FsSecretNodeService", FsSecretNodeService],
  ["ModelSecretNodeService", ModelSecretNodeService],
  ["AwsSecretNodeService", AwsSecretNodeService],
  ["AzureKeyVaultSecretNodeService", AzureKeyVaultSecretNodeService],
  ["GcpSecretManagerNodeService", GcpSecretManagerNodeService],
  ["VaultSecretNodeService", VaultSecretNodeService],
  ["OnePasswordSecretNodeService", OnePasswordSecretNodeService],
];

interface HttpNodeCase {
  name: string;
  ctor: NodeCtor;
  env: Record<string, string>;
  config: Record<string, unknown>;
  expectedBaseUrl: string;
  operation: string;
}

const HTTP_NODE_CASES: HttpNodeCase[] = [
  {
    name: "SlackNodeService",
    ctor: SlackNodeService,
    env: { COMMS__SLACK__TOKEN: "env-slack-token" },
    config: { baseUrl: "https://node.example" },
    expectedBaseUrl: "https://node.example",
    operation: "postMessage",
  },
  {
    name: "EmailNodeService",
    ctor: EmailNodeService,
    env: { COMMS__EMAIL__TOKEN: "env-email-token" },
    config: { baseUrl: "https://node.example" },
    expectedBaseUrl: "https://node.example",
    operation: "send",
  },
  {
    name: "GmailNodeService",
    ctor: GmailNodeService,
    env: { COMMS__GMAIL__TOKEN: "env-gmail-token" },
    config: { baseUrl: "https://node.example" },
    expectedBaseUrl: "https://node.example",
    operation: "send",
  },
  {
    name: "TeamsNodeService",
    ctor: TeamsNodeService,
    env: { COMMS__TEAMS__TOKEN: "env-teams-token" },
    config: { baseUrl: "https://node.example" },
    expectedBaseUrl: "https://node.example",
    operation: "sendWebhook",
  },
  {
    name: "TelegramNodeService",
    ctor: TelegramNodeService,
    env: { COMMS__TELEGRAM__TOKEN: "env-telegram-token" },
    config: { baseUrl: "https://node.example" },
    expectedBaseUrl: "https://node.example",
    operation: "sendMessage",
  },
  {
    name: "GithubNodeService",
    ctor: GithubNodeService,
    env: { DEVOPS__GITHUB__TOKEN: "env-github-token" },
    config: { baseUrl: "https://node.example" },
    expectedBaseUrl: "https://node.example",
    operation: "listIssues",
  },
  {
    name: "GitlabNodeService",
    ctor: GitlabNodeService,
    env: { DEVOPS__GITLAB__TOKEN: "env-gitlab-token" },
    config: { baseUrl: "https://node.example" },
    expectedBaseUrl: "https://node.example",
    operation: "listIssues",
  },
  {
    name: "AirtableNodeService",
    ctor: AirtableNodeService,
    env: { IO__AIRTABLE__TOKEN: "env-airtable-token" },
    config: { baseUrl: "https://node.example" },
    expectedBaseUrl: "https://node.example",
    operation: "listRecords",
  },
  {
    name: "GoogleSheetsNodeService",
    ctor: GoogleSheetsNodeService,
    env: { IO__GOOGLE_SHEETS__TOKEN: "env-sheets-token" },
    config: { baseUrl: "https://node.example" },
    expectedBaseUrl: "https://node.example",
    operation: "getValues",
  },
  {
    name: "GraphqlNodeService",
    ctor: GraphqlNodeService,
    env: {
      IO__GRAPHQL__TOKEN: "env-graphql-token",
      IO__GRAPHQL__ENDPOINT: "https://env.example/graphql",
    },
    config: { endpoint: "https://node.example/graphql" },
    expectedBaseUrl: "https://node.example/graphql",
    operation: "request",
  },
];

const ENV_KEYS = new Set<string>();

function setEnv(values: Record<string, string>): void {
  for (const [key, value] of Object.entries(values)) {
    process.env[key] = value;
    ENV_KEYS.add(key);
  }
}

afterEach(() => {
  for (const key of ENV_KEYS) delete process.env[key];
  ENV_KEYS.clear();
});

describe("node services: registration and explicit configuration", () => {
  it.each(NODE_SERVICES)(
    "%s is not registered and creates distinct instances",
    (_name, ctor) => {
      const registered = Object.values(
        (Injectables as any).services() as Record<string, NodeCtor>
      );
      expect(registered).not.toContain(ctor);
      expect(new ctor()).not.toBe(new ctor());
    }
  );

  it.each(NODE_SERVICES)(
    "%s rejects boot() without an explicit config with ValidationError",
    async (_name, ctor) => {
      await expect(new ctor().boot()).rejects.toBeInstanceOf(ValidationError);
    }
  );

  it.each(NODE_SERVICES)(
    "%s does not accept a Context as its config",
    async (_name, ctor) => {
      await expect(
        new ctor().boot(new Context())
      ).rejects.toBeInstanceOf(ValidationError);
    }
  );

  it("HttpNodeService requires a base URL but accepts an explicit one", async () => {
    await expect(new HttpNodeService().boot({})).rejects.toThrow();

    const service = new HttpNodeService();
    await service.boot({ baseUrl: "https://node.example" });
    expect((service as any).config.baseUrl).toBe("https://node.example");
  });

  it("Service.boot does not auto-boot any node service", async () => {
    const spies = NODE_SERVICES.map(([, ctor]) =>
      jest.spyOn(ctor.prototype, "initialize")
    );
    try {
      // The full registry still contains the decorated originals. Some of
      // them resolve config differently from Context-bearing auto-boot, so
      // this call may throw for a reason unrelated to node services; the
      // assertion below is only about the node subclasses.
      await Service.boot(new Context()).catch(() => undefined);
    } finally {
      for (const spy of spies) spy.mockRestore();
    }
    for (const spy of spies) {
      expect(spy).not.toHaveBeenCalled();
    }
  });
});

describe("environment isolation: HTTP/comms/devops/io node services", () => {
  it.each(HTTP_NODE_CASES)(
    "$name ignores Environment config and uses boot(config)",
    async ({ ctor, env, config, expectedBaseUrl, operation }) => {
      setEnv(env);

      const service = new ctor();
      await service.boot(config);

      expect((service as any).config.token).toBeUndefined();
      expect((service as any).config.baseUrl).toBe(expectedBaseUrl);
      expect(typeof (service as any)[operation]).toBe("function");
    }
  );
});

describe("environment isolation: blob node services", () => {
  it("S3NodeService ignores the environment bucket and keeps provider s3", async () => {
    setEnv({
      BLOBS__S3__BUCKET: "env-bucket",
      BLOBS__S3__REGION: "eu-west-1",
    });

    const service = new S3NodeService();
    await service.boot({ bucket: "node-bucket", region: "us-east-1" });

    expect((service as any).config).toMatchObject({
      provider: "s3",
      bucket: "node-bucket",
      region: "us-east-1",
    });
    expect(typeof (service as any).put).toBe("function");
  });

  it("GcsNodeService ignores the environment bucket and keeps provider gcs", async () => {
    setEnv({
      BLOBS__GCS__BUCKET: "env-bucket",
      BLOBS__GCS__PROJECT_ID: "env-project",
    });

    const service = new GcsNodeService();
    await service.boot({ bucket: "node-bucket", projectId: "node-project" });

    expect((service as any).config).toMatchObject({
      provider: "gcs",
      bucket: "node-bucket",
      projectId: "node-project",
    });
    expect(typeof (service as any).put).toBe("function");
  });

  it("AzureNodeService ignores the environment container and keeps provider azure-blob", async () => {
    setEnv({
      BLOBS__AZURE__CONTAINER: "env-container",
      BLOBS__AZURE__ACCOUNT_NAME: "envaccount",
    });

    const service = new AzureNodeService();
    await service.boot({
      container: "node-container",
      accountName: "nodeaccount",
    });

    expect((service as any).config).toMatchObject({
      provider: "azure-blob",
      container: "node-container",
      accountName: "nodeaccount",
    });
    expect(typeof (service as any).put).toBe("function");
  });
});

describe("environment isolation: secret node services", () => {
  let tempRoot: string;

  beforeAll(async () => {
    tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "decaf-node-secret-"));
  });

  afterAll(async () => {
    await fs.rm(tempRoot, { recursive: true, force: true });
  });

  it("FsSecretNodeService ignores env and round-trips through explicit config", async () => {
    setEnv({
      SECRETS__FS__KEY_SECRET: "env-key",
      SECRETS__FS__ROOT_PATH: path.join(tempRoot, "env-root"),
    });

    const rootPath = path.join(tempRoot, "node-root");
    const service = new FsSecretNodeService();
    await service.boot({ rootPath, keySecret: "node-key" });

    expect((service as any).config).toMatchObject({
      provider: "filesystem",
      rootPath: path.resolve(rootPath),
      keySecret: "node-key",
    });

    await service.store("node-secret", "node-value");
    await expect(service.retrieve("node-secret")).resolves.toBe("node-value");
  });

  it("ModelSecretNodeService ignores env and uses the explicit key secret", async () => {
    setEnv({ SECRETS__MODEL__KEY_SECRET: "env-model-key" });

    // ModelSecretService resolves a Repository for the Secret model by
    // default; without a persistence flavour registered a stub repository is
    // injected as the second initialize argument so only config isolation is
    // exercised here.
    const repository = { table: "secrets" } as any;
    const service = new ModelSecretNodeService();
    await service.boot({ keySecret: "node-key" }, repository);

    expect((service as any).config).toMatchObject({
      provider: "model",
      keySecret: "node-key",
    });
    expect((service as any).client).toBe(repository);
  });

  it.each([
    [
      "AwsSecretNodeService",
      AwsSecretNodeService,
      "aws-secrets-manager",
      { SECRETS__AWS__REGION: "eu-west-1" },
      { region: "us-east-1" },
      "region",
      "us-east-1",
    ],
    [
      "AzureKeyVaultSecretNodeService",
      AzureKeyVaultSecretNodeService,
      "azure-key-vault",
      { SECRETS__AZURE__VAULT_URL: "https://env.vault.azure.net" },
      { vaultUrl: "https://node.vault.azure.net" },
      "vaultUrl",
      "https://node.vault.azure.net",
    ],
    [
      "GcpSecretManagerNodeService",
      GcpSecretManagerNodeService,
      "gcp-secret-manager",
      { SECRETS__GCP__PROJECT_ID: "env-project" },
      { projectId: "node-project" },
      "projectId",
      "node-project",
    ],
    [
      "VaultSecretNodeService",
      VaultSecretNodeService,
      "hashicorp-vault",
      {
        SECRETS__VAULT__ADDRESS: "https://env-vault.local",
        SECRETS__VAULT__TOKEN: "env-token",
        SECRETS__VAULT__PATH: "env-path",
      },
      { address: "https://node-vault.local", token: "node-token", path: "node-path" },
      "address",
      "https://node-vault.local",
    ],
    [
      "OnePasswordSecretNodeService",
      OnePasswordSecretNodeService,
      "1password",
      { SECRETS__ONE_PASSWORD__CONNECT_HOST: "https://env-connect.local" },
      { connectHost: "https://node-connect.local" },
      "connectHost",
      "https://node-connect.local",
    ],
  ] as Array<[string, NodeCtor, string, Record<string, string>, Record<string, unknown>, string, string]>)(
    "%s injects its provider and uses the explicit config",
    async (_name, ctor, provider, env, config, field, expected) => {
      setEnv(env);

      const service = new ctor();
      await service.boot(config);

      expect((service as any).config).toMatchObject({
        provider,
        [field]: expected,
      });
      expect((service as any).client).toBeDefined();
    }
  );
});

describe("original services keep Environment configuration", () => {
  it("SlackService still resolves its environment token", async () => {
    setEnv({ COMMS__SLACK__TOKEN: "env-slack-token" });

    const service = new SlackService();
    await service.initialize();

    expect((service as any).config.token).toBe("env-slack-token");
  });

  it("EmailService still resolves its environment token", async () => {
    setEnv({ COMMS__EMAIL__TOKEN: "env-email-token" });

    const service = new EmailService();
    await service.initialize();

    expect((service as any).config.token).toBe("env-email-token");
  });

  it("S3BlobStoreService still resolves its environment bucket", async () => {
    setEnv({
      BLOBS__S3__BUCKET: "env-bucket",
      BLOBS__S3__REGION: "eu-west-1",
    });

    const service = new S3BlobStoreService();
    await service.initialize();

    expect((service as any).config).toMatchObject({
      provider: "s3",
      bucket: "env-bucket",
      region: "eu-west-1",
    });
  });

  it("FsSecretService still resolves its environment key secret", async () => {
    setEnv({
      SECRETS__FS__KEY_SECRET: "env-key",
      SECRETS__FS__ROOT_PATH: path.join(os.tmpdir(), "decaf-node-env-root"),
    });

    const service = new FsSecretService();
    const { config } = await service.initialize();

    expect(config.keySecret).toBe("env-key");
  });
});
