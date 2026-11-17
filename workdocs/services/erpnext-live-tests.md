# ERPNext Live Tests

`docker/erpnext-compose.yml` provisions a throwaway ERPNext v15 stack for the
ERPNext adapter integration tests. The stack is included in
`npm run prepare-it-tests`; use `npm run prepare-it-tests:erpnext` to start it
by itself. The tests stay opt-in for local runs unless `DECAF_ERPNEXT_IT=1` is
set. GitHub CI enables them and generates temporary credentials automatically.

## Prerequisites

- Docker Engine with Compose v2 (`docker compose version`).
- Roughly 4 GB of free disk for the `frappe/erpnext:v15` image plus volumes.
- The `frappe/erpnext:v15` image is amd64 only; the compose file pins
  `platform: linux/amd64`.

## Start

```bash
cd integrations
npm run prepare-it-tests:erpnext
# equivalent to:
# docker compose -p decaf-erpnext-integration -f docker/erpnext-compose.yml up -d --wait
```

The first run pulls the image, initializes MariaDB, creates the site, and
installs the `erpnext` app. Expect about 2-5 minutes cold (image pull excluded,
about 90-120 s once the image is cached). `up --wait` returns only after the
`frontend` HTTP healthcheck passes.

The API is exposed on host port `8181`:

```bash
curl -s http://localhost:8181/api/method/ping
# {"message":"pong"}
```

In sandboxed CI runners whose shell lives in a different network namespace from
the Docker host (for example the Paperclip runner), `localhost` does not reach
published ports. Use the Docker bridge gateway instead:

```bash
export ERPNEXT_URL=http://172.17.0.1:8181
curl -s "$ERPNEXT_URL/api/method/ping"
```

## Stop

```bash
cd integrations
npm run teardown-it-tests:erpnext
```

Or scope the teardown manually:

```bash
docker compose -p decaf-erpnext-integration -f docker/erpnext-compose.yml down -v --remove-orphans
```

All containers and volumes carry `decaf.issue=SAA-1672` labels; verify cleanup
with:

```bash
docker ps -a --filter label=decaf.issue=SAA-1672
docker volume ls --filter label=decaf.issue=SAA-1672
```

## Credentials and environment contract

All defaults are sandbox-only throwaways; override them through the environment
before starting the stack.

| Variable | Default | Purpose |
| --- | --- | --- |
| `ERPNEXT_VERSION` | `v15` | `frappe/erpnext` image tag |
| `ERPNEXT_SITE_NAME` | `frontend` | Frappe site name created at boot |
| `ERPNEXT_ADMIN_PASSWORD` | `admin123` | `Administrator` password |
| `ERPNEXT_DB_ROOT_PASSWORD` | `erpnext-db-root` | MariaDB root password |
| `ERPNEXT_URL` | `http://localhost:8181` | Base URL consumed by adapter tests |
| `ERPNEXT_TOKEN` | generated | `api_key:api_secret` for token auth |
| `DECAF_ERPNEXT_IT` | unset | Set to `1` to opt in to live ERPNext tests |

Integration tests follow the `DECAF_KUBERNETES_IT=1` precedent: they skip unless
`DECAF_ERPNEXT_IT=1` is set, then read `ERPNEXT_URL` and `ERPNEXT_TOKEN`.

The API key/secret pair is per-boot and is not baked into the stack. Generate it
once after boot with a session login:

```bash
BASE=http://localhost:8181
curl -s -c /tmp/erpnext.cookies \
  -d 'usr=Administrator&pwd=admin123' "$BASE/api/method/login"
curl -s -b /tmp/erpnext.cookies -X POST \
  "$BASE/api/method/frappe.core.doctype.user.user.generate_keys?user=Administrator"
```

`generate_keys` returns `{ "message": { "api_key": "...", "api_secret": "..." } }`.
Export them as a single token:

```bash
export DECAF_ERPNEXT_IT=1
export ERPNEXT_URL=http://localhost:8181
export ERPNEXT_TOKEN="<api_key>:<api_secret>"
```

Token auth is then `Authorization: token <api_key>:<api_secret>`.

## Site setup notes

`bench new-site --install-app erpnext` creates an empty ERPNext site. It does
**not** run the setup wizard, so no `Company` exists initially (`GET
/api/resource/Company` returns `{"data":[]}`). Tests that need accounting data
must create the required records (for example a `Company`) through the REST API
as part of their fixture setup.

Standard doctypes available immediately include `Sales Invoice`, `Payment
Entry`, `Payment Request`, `Subscription`, and `Journal Entry`. Promotion and
promo-code doctypes are not part of stock ERPNext and are expected to be defined
by the adapter/test fixtures.

## Cleanup ownership

The stack is ephemeral and must be torn down at the end of a test session. If a
teardown fails, block the owning issue and open a cleanup child for the DevOps
Engineer instead of leaving containers or volumes behind.
