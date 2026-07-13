#!/usr/bin/env bash
#
# Creates two dummy dashboards in Kibana via the saved objects API.
#
# Usage: setup-dashboards.sh <kibana_host>
#   kibana_host e.g. http://localhost:5602
#
set -euo pipefail

KIBANA_HOST=${1:?Usage: setup-dashboards.sh <kibana_host>}

echo "Waiting for Kibana to be ready..."
for i in $(seq 1 60); do
  if curl -sf "${KIBANA_HOST}/api/status" >/dev/null 2>&1; then
    echo "Kibana is ready."
    break
  fi
  sleep 2
done

# Create an index pattern first (required for dashboards)
echo "Creating index pattern..."
INDEX_PATTERN_RESPONSE=$(curl -sf -X POST "${KIBANA_HOST}/api/saved_objects/index-pattern" \
  -H "kbn-xsrf: true" \
  -H "Content-Type: application/json" \
  -d '{
    "attributes": {
      "title": "test-logs-*",
      "timeFieldName": "@timestamp"
    }
  }')

INDEX_PATTERN_ID=$(echo "$INDEX_PATTERN_RESPONSE" | python3 -c "import sys,json; print(json.load(sys.stdin)['id'])")
echo "Created index pattern: $INDEX_PATTERN_ID"

# Create Dashboard A
echo "Creating Dashboard A..."
DASHBOARD_A_RESPONSE=$(curl -sf -X POST "${KIBANA_HOST}/api/saved_objects/dashboard" \
  -H "kbn-xsrf: true" \
  -H "Content-Type: application/json" \
  -d "{
    \"attributes\": {
      \"title\": \"E2E Test Dashboard A\",
      \"description\": \"Dashboard A for e2e testing\",
      \"panelsJSON\": \"[]\",
      \"optionsJSON\": \"{\\\"hidePanelTitles\\\":false,\\\"useMargins\\\":true}\",
      \"version\": 3,
      \"timeRestore\": false
    }
  }")

DASHBOARD_A_ID=$(echo "$DASHBOARD_A_RESPONSE" | python3 -c "import sys,json; print(json.load(sys.stdin)['id'])")
echo "Created Dashboard A: $DASHBOARD_A_ID"

# Create Dashboard B
echo "Creating Dashboard B..."
DASHBOARD_B_RESPONSE=$(curl -sf -X POST "${KIBANA_HOST}/api/saved_objects/dashboard" \
  -H "kbn-xsrf: true" \
  -H "Content-Type: application/json" \
  -d "{
    \"attributes\": {
      \"title\": \"E2E Test Dashboard B\",
      \"description\": \"Dashboard B for e2e testing\",
      \"panelsJSON\": \"[]\",
      \"optionsJSON\": \"{\\\"hidePanelTitles\\\":false,\\\"useMargins\\\":true}\",
      \"version\": 3,
      \"timeRestore\": false
    }
  }")

DASHBOARD_B_ID=$(echo "$DASHBOARD_B_RESPONSE" | python3 -c "import sys,json; print(json.load(sys.stdin)['id'])")
echo "Created Dashboard B: $DASHBOARD_B_ID"

# Output the dashboard IDs for the test harness
cat > "$(dirname "$0")/dashboards.json" << EOF
{
  "indexPatternId": "$INDEX_PATTERN_ID",
  "dashboardA": "$DASHBOARD_A_ID",
  "dashboardB": "$DASHBOARD_B_ID"
}
EOF

echo "Dashboard setup complete."
cat "$(dirname "$0")/dashboards.json"
