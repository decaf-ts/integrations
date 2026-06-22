# 1Password Secret Service

This provider integrates with 1Password Connect via its HTTP API to manage secrets.

## Setup

### Prerequisites

- A running instance of [1Password Connect](https://developer.1password.com/docs/connect/) or access to a 1Password account with API access enabled
- A vault ID from your 1Password account
- An API token (for 1Password Connect) or service account token (for 1Password Accounts)

### Configuration

```typescript
import { OnePasswordSecretService, OnePasswordSecretServiceConfig } from "@decaf-ts/integrations/onepassword";

const config: OnePasswordSecretServiceConfig = {
  provider: "1password",
  connectHost: "http://localhost:8080", // or your 1Password Connect endpoint
  connectToken: "your-api-token", // optional if using service account token
  vaultId: "your-vault-id", // optional, can be set per operation
  itemIdTemplate: "ItemId_${name}", // optional, for direct item ID access
};

const service = new OnePasswordSecretService(config);
```

### Authentication

The provider supports two authentication methods:

1. **1Password Connect Token**: Use `connectToken` in configuration
   ```typescript
   connectToken: "your-connect-api-token"
   ```

2. **Service Account Token**: Use service account authentication via `Authorization` header

## Supported Operations

### Retrieve Secrets ✅

Retrieving secrets is fully supported:

```typescript
const secret = await service.retrieve("my-secret-name");
```

The provider queries items by title and extracts the secret value from the first matching item.

### List Secrets ✅

List all secrets in a vault:

```typescript
const secrets = await service.list({ limit: 100 });
```

### Check Existence ✅

Check if a secret exists:

```typescript
const exists = await service.exists("my-secret-name");
```

### Metadata Retrieval ✅

Get metadata about a secret:

```typescript
const metadata = await service.metadata("my-secret-name", { includeTags: true });
```

### Store Secrets⚠️

**Limitation**: Storing secrets may require additional permissions depending on your 1Password setup:

- 1Password Connect: Store operations work if the API token has write permissions
- 1Password Accounts: Store operations may be restricted; verify API permissions

```typescript
await service.store("my-secret-name", { username: "user", password: "pass" });
```

### Delete Secrets⚠️

**Limitation**: Deleting secrets may require additional permissions:

- 1Password Connect: Delete operations work if the API token has delete permissions
- 1Password Accounts: Delete operations may be restricted

```typescript
await service.delete("my-secret-name", { force: false });
```

**Notes**:
- If `force` is false (default), the item is soft-deleted (moved to trash)
- If `force` is true, the item may be permanently deleted depending on 1Password settings

## Limitations

### API Version Dependencies

This implementation primarily uses the 1Password Connect API. The exact capabilities depend on:

1. **1Password Connect Version**: Newer versions have more complete CRUD support
2. **API Token Permissions**: Tokens may be restricted to read-only or specific vaults
3. **1Password Account Type**: Business/Enterprise accounts have different API capabilities

### Item Creation

Creating new items requires:

1. The API token must have write permissions for the target vault
2. The item must be created with the correct category (defaults to "login")
3. Fields must match the expected 1Password item structure

### Item Retrieval

By default, the provider retrieves items by searching for a matching title. This may:

- Return the first matching item if multiple items have the same name
- Require exact title matching (case-sensitive)

To avoid ambiguity, use the `itemIdTemplate` configuration to directly specify item IDs using a template pattern.

## Error Handling

The provider throws specific error codes:

- `SECRET_NOT_FOUND`: Item doesn't exist or vault ID is invalid
- `SECRET_PROVIDER_AUTH_FAILED`: Invalid or expired API token
- `SECRET_PROVIDER_PERMISSION_DENIED`: Insufficient permissions for the operation
- `SECRET_PROVIDER_RATE_LIMITED`: API rate limit exceeded
- `SECRET_PROVIDER_UNAVAILABLE`: 1Password Connect is unreachable

## Alternative Approaches

If full CRUD operations are not available:

1. **Use 1Password CLI**: For administrative operations, use the 1Password CLI with `op` command
2. **1Password Accounts API**: Some operations may work better with the 1Password Accounts API instead of Connect
3. **Service Account Permissions**: Request extended permissions for your service account
4. **Hybrid Approach**: Use this provider for retrieval only, manage creation/deletion through other means

## Example Usage

```typescript
import { OnePasswordSecretService } from "@decaf-ts/integrations/onepassword";

async function main() {
  const service = new OnePasswordSecretService({
    provider: "1password",
    connectHost: "http://localhost:8080",
    connectToken: process.env.OP_CONNECT_TOKEN,
    vaultId: "vault-id-here",
  });

  // Check if secret exists
  if (await service.exists("my-api-key")) {
    // Retrieve existing secret
    const secret = await service.retrieve("my-api-key");
    console.log("Secret:", secret);
  } else {
    // Create new secret
    await service.store("my-api-key", "my-secret-value");
    console.log("Secret created");
  }

  // List all secrets
  const allSecrets = await service.list({ limit: 50 });
  console.log("All secrets:", allSecrets);
}

main();
```

## Troubleshooting

### Connection Errors

Ensure 1Password Connect is running and accessible:
```bash
curl http://localhost:8080/v1/items
```

### Authentication Errors

Verify your API token is valid and has the required permissions.

### Permission Denied

Check that your API token has write/delete permissions for the target vault. You may need to:

- Update the token scope in 1Password Connect
- Request elevated permissions from your 1Password administrator
- Use a different authentication method

## See Also

- [1Password Connect Documentation](https://developer.1password.com/docs/connect/)
- [1Password API Overview](https://developer.1password.com/docs/api/)
