# Secret Services

`@decaf-ts/integrations/secrets` provides a provider-agnostic secret API plus backend implementations for local encrypted storage and external secret systems.

## Core API

The core layer defines the abstract [`SecretService`](../../src/secrets/core/SecretService.ts) contract:

- `store`
- `retrieve`
- `delete`
- `exists`
- `list`
- `metadata`
- optional `rotate`

It also exports the shared error, name, reference, serialization, and type helpers used by every provider.

## When To Use It

Use these services when you want a common secret interface while keeping provider-specific storage details hidden.

## Providers

### Model-backed secret service

[`ModelSecretService`](../../src/secrets/model/ModelSecretService.ts) stores encrypted payloads in a Decaf model.

- best for application-owned secret storage
- supports encrypted-at-rest payloads
- uses the crypto helpers in [`ModelSecretCrypto`](../../src/secrets/model/ModelSecretCrypto.ts)

### AWS Secrets Manager

[`AwsSecretService`](../../src/secrets/aws/AwsSecretService.ts) wraps AWS Secrets Manager.

- use when your runtime already has AWS credentials
- supports standard secret CRUD and listing

### Azure Key Vault

[`AzureKeyVaultSecretService`](../../src/secrets/azure/AzureKeyVaultSecretService.ts) wraps Azure Key Vault.

- use when your runtime is already authenticated to Azure
- supports create, retrieve, delete, list, and metadata flows

### Google Secret Manager

[`GcpSecretManagerService`](../../src/secrets/gcp/GcpSecretManagerService.ts) wraps Google Secret Manager.

- use when your runtime is running with GCP credentials
- supports secret version management and listing

### HashiCorp Vault

[`VaultSecretService`](../../src/secrets/vault/VaultSecretService.ts) wraps Vault KV v2.

- use when you already have a Vault deployment and token
- supports read/write/list/delete against KV v2 paths

### 1Password

[`OnePasswordSecretService`](../../src/secrets/onepassword/OnePasswordSecretService.ts) wraps 1Password Connect / account-style access.

- good for teams already using 1Password as the secret backend
- retrieval and metadata are the most reliable operations
- write/delete support depends on token permissions and deployment mode

## Typical Usage

```ts
import { AwsSecretService } from "@decaf-ts/integrations/secrets/aws";

const secrets = new AwsSecretService({
  provider: "aws",
  region: "eu-west-1",
});

await secrets.store("api-key", { value: "secret-value" });
const current = await secrets.retrieve("api-key");
```

## Error Handling

- Every provider translates library-specific failures into Decaf errors.
- `parseError()` is intentionally protected and only used for translation at the service boundary.

## Notes

- Prefer the provider-specific package entry point when you only need one backend.
- Prefer the core abstractions when you need provider-agnostic application code.
