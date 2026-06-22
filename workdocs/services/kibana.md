# Kibana Services

`@decaf-ts/integrations/kibana` provisions Kibana spaces, data views, dashboards, roles, users, and auth-backed helpers through [`KibanaService`](../../src/kibana/services/KibanaService.ts).

## When To Use It

Use this package when you need to:

- create a Kibana space for a tenant or realm
- create one or more data views
- seed default dashboards
- create roles and users in Kibana
- produce embed URLs for dashboards

## Core Flow

1. Create a `KibanaService`.
2. Call `initialize(config)` with a `KibanaSetupConfig`.
3. Call `setupOrganization(config)` to build the full tenant shape.

```ts
import { KibanaService } from "@decaf-ts/integrations/kibana";

const service = new KibanaService();
await service.initialize({
  protocol: "https",
  host: "kibana.example.com",
  es_host: "elasticsearch.example.com",
  realm: "acme",
  realmApiUser: {
    username: "kibana-admin",
    password: process.env.KIBANA_ADMIN_PASSWORD!,
  },
});
```

## Service Responsibilities

- [`KibanaSpaceService`](../../src/kibana/services/KibanaSpaceService.ts): create and update spaces.
- [`KibanaDataViewService`](../../src/kibana/services/KibanaDataViewService.ts): create and manage data views.
- [`KibanaRoleService`](../../src/kibana/services/KibanaRoleService.ts): create Kibana roles.
- [`KibanaUserService`](../../src/kibana/services/KibanaUserService.ts): create and update users.
- [`KibanaDashboardService`](../../src/kibana/services/KibanaDashboardService.ts): clone dashboards and generate embed URLs.
- [`KibanaAuthService`](../../src/kibana/services/KibanaAuthService.ts): handle auth-related calls and tokens.

## Typical Usage

### Full organization bootstrap

`setupOrganization()` creates the space, clones default dashboards, creates data views, creates the role, creates the tenant user, and verifies the space setup.

```ts
await service.setupOrganization(setupConfig);
```

### Dashboard embeds

Use `generateDashboardEmbedUrl()` when you need an embeddable URL for a dashboard widget.

```ts
const url = service.generateDashboardEmbedUrl({
  space: "acme",
  dashboardId: "12345",
  showTimeFilter: true,
});
```

### Targeted operations

Use the delegated methods when you only need one change:

- `createSpace`, `updateSpace`, `deleteSpace`
- `createDataViews`, `deleteDataView`, `setDefaultDataView`
- `createRole`
- `createUser`, `updateUser`
- `cloneDefaultDashboards`, `verifySpaceSetup`

## Logging And Errors

- Methods are wrapped in the Decaf contextual logging flow through `logCtx(...)`.
- HTTP errors are translated to Decaf errors before leaving the service boundary.
- `parseError()` is intentionally protected and only used for error translation.
