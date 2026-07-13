#!/usr/bin/env bash
#
# Creates two dummy dashboards in Superset via the REST API.
# Also creates an embedded configuration for each dashboard and sets allowed domains.
#
# Usage: setup-dashboards.sh <superset_host>
#   superset_host e.g. http://localhost:8089
#
set -euo pipefail

SUPERSET_HOST=${1:?Usage: setup-dashboards.sh <superset_host>}

echo "Waiting for Superset to be ready..."
for i in $(seq 1 60); do
  if curl -sf "${SUPERSET_HOST}/health" >/dev/null 2>&1; then
    echo "Superset is ready."
    break
  fi
  sleep 2
done

# Authenticate and get access token
echo "Authenticating..."
LOGIN_RESPONSE=$(curl -sf -X POST "${SUPERSET_HOST}/api/v1/security/login" \
  -H "Content-Type: application/json" \
  -d '{
    "username": "admin",
    "password": "admin",
    "provider": "db",
    "refresh": false
  }')

ACCESS_TOKEN=$(echo "$LOGIN_RESPONSE" | python3 -c "import sys,json; print(json.load(sys.stdin)['access_token'])")
echo "Got access token."

AUTH_HEADER="Authorization: Bearer ${ACCESS_TOKEN}"

# Create Dashboard A
echo "Creating Dashboard A..."
DASHBOARD_A_RESPONSE=$(curl -sf -X POST "${SUPERSET_HOST}/api/v1/dashboard/" \
  -H "${AUTH_HEADER}" \
  -H "Content-Type: application/json" \
  -d '{
    "dashboard_title": "E2E Test Dashboard A",
    "slug": "e2e-dashboard-a",
    "position_json": "{\"DASHBOARD_VERSION_KEY\": \"v2\"}",
    "metadata": "{\"chart_configuration\": {}}"
  }')

DASHBOARD_A_ID=$(echo "$DASHBOARD_A_RESPONSE" | python3 -c "import sys,json; print(json.load(sys.stdin)['id'])")
echo "Created Dashboard A: $DASHBOARD_A_ID"

# Create Dashboard B
echo "Creating Dashboard B..."
DASHBOARD_B_RESPONSE=$(curl -sf -X POST "${SUPERSET_HOST}/api/v1/dashboard/" \
  -H "${AUTH_HEADER}" \
  -H "Content-Type: application/json" \
  -d '{
    "dashboard_title": "E2E Test Dashboard B",
    "slug": "e2e-dashboard-b",
    "position_json": "{\"DASHBOARD_VERSION_KEY\": \"v2\"}",
    "metadata": "{\"chart_configuration\": {}}"
  }')

DASHBOARD_B_ID=$(echo "$DASHBOARD_B_RESPONSE" | python3 -c "import sys,json; print(json.load(sys.stdin)['id'])")
echo "Created Dashboard B: $DASHBOARD_B_ID"

# Create embedded configurations for both dashboards
echo "Creating embedded configuration for Dashboard A..."
EMBEDDED_A_RESPONSE=$(curl -sf -X POST "${SUPERSET_HOST}/api/v1/dashboard/embedded/" \
  -H "${AUTH_HEADER}" \
  -H "Content-Type: application/json" \
  -d "{
    \"resource_name\": \"Dashboard\",
    \"resource_id\": ${DASHBOARD_A_ID},
    \"allowed_domains\": [\"http://localhost:3002\", \"http://localhost:3001\"]
  }")

EMBEDDED_A_UUID=$(echo "$EMBEDDED_A_RESPONSE" | python3 -c "import sys,json; print(json.load(sys.stdin)['uuid'])")
echo "Created embedded config A: $EMBEDDED_A_UUID"

echo "Creating embedded configuration for Dashboard B..."
EMBEDDED_B_RESPONSE=$(curl -sf -X POST "${SUPERSET_HOST}/api/v1/dashboard/embedded/" \
  -H "${AUTH_HEADER}" \
  -H "Content-Type: application/json" \
  -d "{
    \"resource_name\": \"Dashboard\",
    \"resource_id\": ${DASHBOARD_B_ID},
    \"allowed_domains\": [\"http://localhost:3002\", \"http://localhost:3001\"]
  }")

EMBEDDED_B_UUID=$(echo "$EMBEDDED_B_RESPONSE" | python3 -c "import sys,json; print(json.load(sys.stdin)['uuid'])")
echo "Created embedded config B: $EMBEDDED_B_UUID"

# Output the dashboard IDs for the test harness
cat > "$(dirname "$0")/dashboards.json" << EOF
{
  "dashboardA": "${DASHBOARD_A_ID}",
  "dashboardB": "${DASHBOARD_B_ID}",
  "embeddedA": "${EMBEDDED_A_UUID}",
  "embeddedB": "${EMBEDDED_B_UUID}"
}
EOF

echo "Dashboard setup complete."
cat "$(dirname "$0")/dashboards.json"
