#!/usr/bin/env bash
#
# Orchestration script: build Docker images and run Playwright e2e tests
# for both Kibana and Superset dashboard embed plugins.
#
# Usage:
#   ./tests/e2e/plugins/run-e2e.sh [kibana|superset|all]
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
INTEGRATIONS_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"

MODE=${1:-all}

run_kibana() {
  echo "=== Kibana e2e tests ==="
  cd "$INTEGRATIONS_ROOT"
  npx playwright test \
    --config tests/e2e/plugins/playwright.config.ts \
    "$SCRIPT_DIR/kibana.e2e.test.ts"
}

run_superset() {
  echo "=== Superset e2e tests ==="
  cd "$INTEGRATIONS_ROOT"
  npx playwright test \
    --config tests/e2e/plugins/playwright.config.ts \
    "$SCRIPT_DIR/superset.e2e.test.ts"
}

case "$MODE" in
  kibana)
    run_kibana
    ;;
  superset)
    run_superset
    ;;
  all)
    run_kibana
    echo
    run_superset
    ;;
  *)
    echo "Usage: $0 [kibana|superset|all]"
    exit 1
    ;;
esac

echo "=== E2e tests complete ==="
echo "Screenshots: $SCRIPT_DIR/screenshots/"
