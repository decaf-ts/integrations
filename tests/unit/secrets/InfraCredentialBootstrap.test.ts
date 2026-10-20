/**
 * @module integrations/tests/infra-credential-bootstrap
 * @summary Unit coverage for infra credential seeding.
 * @description Verifies idempotent seeding, overwrite semantics, retrieval and
 * metadata forwarding through {@link InfraCredentialBootstrap} backed by a real
 * filesystem secret service in a temporary directory.
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { NotFoundError } from "@decaf-ts/db-decorators";
import {
  createInfraCredentialBootstrap,
  InfraCredentialBootstrap,
} from "../../../src/secrets/InfraCredentialBootstrap";
import { FsSecretService } from "../../../src/secrets/fs/FsSecretService";

describe("InfraCredentialBootstrap", () => {
  let root: string;
  let bootstrap: InfraCredentialBootstrap;

  beforeAll(async () => {
    root = path.join(
      await fs.mkdtemp(path.join(os.tmpdir(), "decaf-infra-bootstrap-")),
      "store"
    );
    bootstrap = await createInfraCredentialBootstrap({
      provider: "filesystem",
      rootPath: root,
      keySecret: "bootstrap-test-key",
      keyId: "bootstrap-key",
    });
  });

  afterAll(async () => {
    await fs.rm(path.dirname(root), { recursive: true, force: true });
  });

  it("creates a bootstrap around a booted filesystem service", () => {
    expect(bootstrap).toBeInstanceOf(InfraCredentialBootstrap);
    expect(bootstrap.service).toBeInstanceOf(FsSecretService);
    expect(bootstrap.service.provider).toBe("filesystem");
  });

  it("ensures seeds by storing values and returning references", async () => {
    const references = await bootstrap.ensure([
      { name: "database-password", value: "db-secret" },
      {
        name: "service-account",
        value: { clientId: "svc", clientSecret: "shhh" },
        contentType: "application/json",
        tags: { scope: "infra" },
      },
    ]);

    expect(references).toHaveLength(2);
    expect(references.map((reference) => reference.name)).toEqual([
      "database-password",
      "service-account",
    ]);

    await expect(bootstrap.retrieve("database-password")).resolves.toBe(
      "db-secret"
    );
    await expect(bootstrap.retrieve("service-account")).resolves.toEqual({
      clientId: "svc",
      clientSecret: "shhh",
    });
  });

  it("forwards contentType and tags into the stored envelope", async () => {
    await bootstrap.ensure([
      {
        name: "tagged-secret",
        value: "tagged-value",
        contentType: "text/plain",
        tags: { owner: "platform" },
      },
    ]);

    const raw = await fs.readFile(
      path.join(root, "tagged-secret.json"),
      "utf8"
    );
    expect(JSON.parse(raw)).toMatchObject({
      contentType: "text/plain",
      tags: { owner: "platform" },
    });
  });

  it("is idempotent when a seed already exists", async () => {
    await bootstrap.ensure([{ name: "idempotent", value: "original" }]);

    const references = await bootstrap.ensure([
      { name: "idempotent", value: "replacement" },
    ]);

    expect(references).toEqual([]);
    await expect(bootstrap.retrieve("idempotent")).resolves.toBe("original");
  });

  it("overwrites an existing seed when overwrite is requested", async () => {
    await bootstrap.ensure([{ name: "overwrite-me", value: "original" }]);

    const references = await bootstrap.ensure([
      { name: "overwrite-me", value: "replacement", overwrite: true },
    ]);

    expect(references).toHaveLength(1);
    await expect(bootstrap.retrieve("overwrite-me")).resolves.toBe(
      "replacement"
    );
  });

  it("reports missing seeds as NotFoundError", async () => {
    await expect(bootstrap.retrieve("never-seeded")).rejects.toBeInstanceOf(
      NotFoundError
    );
  });
});
