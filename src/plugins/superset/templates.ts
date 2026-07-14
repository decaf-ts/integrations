/**
 * @module integrations/plugins/superset/templates
 * @summary Patch and build script templates for the Superset embed plugin.
 * @description Holds all patch scripts (Python + Bash) and build scripts as
 * string templates. These are materialized onto disk by the installer. Decaf
 * does not generate new Superset source — it patches existing internal files
 * (`superset-frontend/src/embedded/index.tsx` and
 * `superset-embedded-sdk/src/index.ts`) following the reference implementation
 * from DECAF-40 §9.
 *
 * The patch adds a `switchDashboard` method to Superset's existing Switchboard
 * channel, replacing only `DashboardPage` while keeping the iframe element,
 * document, contentWindow, React runtime, and message channel alive.
 */
import { SUPERSET_PLUGIN_ID, SUPERSET_PLUGIN_VERSION } from "./manifest";

export interface SupersetPatchFile {
  /** Relative path within the target directory. */
  path: string;
  /** File contents. */
  content: string;
  /** Whether to mark the file executable on POSIX. */
  executable?: boolean;
}

const APPLY_PATCH_PY = `#!/usr/bin/env python3

from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path


FRONTEND_FILE = Path("superset-frontend/src/embedded/index.tsx")
SDK_FILE = Path("superset-embedded-sdk/src/index.ts")


class PatchError(RuntimeError):
    pass


def replace_once(
    content: str,
    old: str,
    new: str,
    description: str,
) -> str:
    count = content.count(old)

    if count != 1:
        raise PatchError(
            f"{description}: expected exactly one occurrence, found {count}"
        )

    return content.replace(old, new, 1)


def replace_regex_once(
    content: str,
    pattern: re.Pattern[str],
    replacement: str,
    description: str,
) -> str:
    updated, count = pattern.subn(replacement, content, count=1)

    if count != 1:
        raise PatchError(
            f"{description}: expected exactly one match, found {count}"
        )

    return updated


def patch_react_import(content: str) -> str:
    react_import_pattern = re.compile(
        r"import\\s*\\{\\s*([^}]+)\\s*\\}\\s*from\\s*'react';"
    )

    match = react_import_pattern.search(content)

    if not match:
        raise PatchError("Could not locate the named React import")

    imports = [
        value.strip()
        for value in match.group(1).replace("\\n", " ").split(",")
        if value.strip()
    ]

    required_imports = ["lazy", "Suspense", "useEffect", "useState"]

    for required_import in required_imports:
        if required_import not in imports:
            imports.append(required_import)

    replacement = (
        "import {\\n  "
        + ",\\n  ".join(imports)
        + ",\\n} from 'react';"
    )

    return (
        content[: match.start()]
        + replacement
        + content[match.end() :]
    )


def locate_embedded_component(
    content: str,
) -> tuple[re.Match[str], str]:
    pattern = re.compile(
        r"const\\s+([A-Za-z0-9_]+)\\s*=\\s*\\(\\)\\s*=>\\s*\\{.*?\\};\\s*"
        r"(?=const\\s+EmbeddedRoute)",
        re.DOTALL,
    )

    match = pattern.search(content)

    if match:
        return match, match.group(1)

    raise PatchError(
        "Could not find an embedded dashboard component before EmbeddedRoute"
    )


def patch_frontend(frontend_path: Path) -> None:
    content = frontend_path.read_text(encoding="utf-8")

    if "SUPERSET_SWITCHABLE_EMBED_PATCH" in content:
        print(f"Already patched: {frontend_path}")
        return

    content = patch_react_import(content)

    component_match, component_name = locate_embedded_component(
        content
    )

    replacement_component = """// SUPERSET_SWITCHABLE_EMBED_PATCH
//
// Allows the existing embedded Superset document to replace DashboardPage
// without navigating or recreating the iframe.
//
// Security:
// - This method is exposed only through Superset's existing Switchboard
//   MessageChannel.
// - The host application must obtain a guest token for the target dashboard.
// - Superset's normal Allowed Domains validation remains in effect.

interface SwitchDashboardPayload {
  dashboardId: string;
  guestToken: string;
}

interface SwitchDashboardResult {
  dashboardId: string;
  accepted: true;
}

type DashboardSwitchHandler = (
  payload: SwitchDashboardPayload,
) => Promise<SwitchDashboardResult>;

let dashboardSwitchHandler: DashboardSwitchHandler | undefined;

const __COMPONENT_NAME__ = () => {
  const uiConfig = useUiConfig();

  const [dashboardId, setDashboardId] = useState<string | null>(
    bootstrapData.embedded!.dashboard_id,
  );

  useEffect(() => {
    dashboardSwitchHandler = async ({
      dashboardId: requestedDashboardId,
      guestToken,
    }: SwitchDashboardPayload) => {
      const nextDashboardId = requestedDashboardId.trim();

      if (!nextDashboardId) {
        throw new Error(
          'dashboardId must be a non-empty string',
        );
      }

      if (
        typeof guestToken !== 'string' ||
        guestToken.trim().length === 0
      ) {
        throw new Error(
          'guestToken must be a non-empty string',
        );
      }

      setDashboardId(null);

      displayedUnauthorizedToast = false;

      setupGuestClient(guestToken);

      await new Promise<void>(resolve => {
        window.requestAnimationFrame(() => resolve());
      });

      setDashboardId(nextDashboardId);

      return {
        dashboardId: nextDashboardId,
        accepted: true,
      };
    };

    return () => {
      dashboardSwitchHandler = undefined;
    };
  }, []);

  useEffect(() => {
    if (!uiConfig?.emitDataMasks) {
      return undefined;
    }

    let previousDataMask = store.getState().dataMask;

    return store.subscribe(() => {
      const currentDataMask = store.getState().dataMask;

      if (previousDataMask !== currentDataMask) {
        Switchboard.emit('observeDataMask', {
          ...currentDataMask,
          ...getDataMaskChangeTrigger(
            currentDataMask,
            previousDataMask,
          ),
        });

        previousDataMask = currentDataMask;
      }
    });
  }, [uiConfig?.emitDataMasks]);

  if (!dashboardId) {
    return <Loading />;
  }

  return (
    <LazyDashboardPage
      key={dashboardId}
      idOrSlug={dashboardId}
    />
  );
};
""".replace("__COMPONENT_NAME__", component_name)

    content = (
        content[: component_match.start()]
        + replacement_component
        + content[component_match.end() :]
    )

    switchboard_anchor_candidates = [
        (
            "    Switchboard.defineMethod("
            "'getScrollSize', embeddedApi.getScrollSize);"
        ),
        (
            "    Switchboard.defineMethod(\\n"
            "      'getScrollSize',\\n"
            "      embeddedApi.getScrollSize,\\n"
            "    );"
        ),
    ]

    switchboard_method = """    Switchboard.defineMethod(
      'switchDashboard',
      async (
        payload: SwitchDashboardPayload,
      ): Promise<SwitchDashboardResult> => {
        if (!dashboardSwitchHandler) {
          throw new Error(
            'The embedded dashboard is not ready to switch',
          );
        }

        return dashboardSwitchHandler(payload);
      },
    );

"""

    anchor_found = False

    for anchor in switchboard_anchor_candidates:
        if content.count(anchor) == 1:
            content = content.replace(
                anchor,
                switchboard_method + anchor,
                1,
            )
            anchor_found = True
            break

    if not anchor_found:
        raise PatchError(
            "Could not locate the getScrollSize Switchboard method"
        )

    frontend_path.write_text(content, encoding="utf-8")
    print(f"Patched: {frontend_path}")


def patch_guest_token_fetch_type(content: str) -> str:
    candidates = [
        "export type GuestTokenFetchFn = () => Promise<string>;",
        (
            "export type GuestTokenFetchFn = "
            "() => Promise<string>;"
        ),
    ]

    replacement = """// SUPERSET_SWITCHABLE_EMBED_SDK_PATCH
//
// dashboardId is undefined for the initial dashboard bootstrap.
// After a successful dashboard switch, token refreshes receive the active
// dashboard UUID.
export type GuestTokenFetchFn = (
  dashboardId?: string,
) => Promise<string>;"""

    for candidate in candidates:
        if content.count(candidate) == 1:
            return content.replace(
                candidate,
                replacement,
                1,
            )

    raise PatchError("Could not locate GuestTokenFetchFn")


def patch_embedded_dashboard_type(content: str) -> str:
    type_pattern = re.compile(
        r"(export\\s+(?:interface|type)\\s+EmbeddedDashboard"
        r".*?\\{)(.*?)(\\n\\};)",
        re.DOTALL,
    )

    match = type_pattern.search(content)

    if not match:
        raise PatchError(
            "Could not locate the EmbeddedDashboard public type"
        )

    body = match.group(2)

    if "switchDashboard:" in body:
        return content

    method = """
  /**
   * Replaces DashboardPage in the existing iframe document.
   *
   * The value must be the target dashboard UUID/id accepted by
   * DashboardPage, not the embedded-configuration UUID used in the
   * initial /embedded/:uuid URL.
   */
  switchDashboard: (
    dashboardId: string,
  ) => Promise<{
    dashboardId: string;
    accepted: true;
  }>;
"""

    updated_type = (
        match.group(1)
        + body.rstrip()
        + "\\n"
        + method.rstrip()
        + match.group(3)
    )

    return (
        content[: match.start()]
        + updated_type
        + content[match.end() :]
    )


def patch_initial_guest_token_fetch(content: str) -> str:
    candidates = [
        "fetchGuestToken(),",
        "await fetchGuestToken(),",
    ]

    for candidate in candidates:
        if content.count(candidate) >= 1:
            return content.replace(
                candidate,
                candidate.replace(
                    "fetchGuestToken()",
                    "fetchGuestToken(undefined)",
                ),
                1,
            )

    raise PatchError(
        "Could not locate the initial fetchGuestToken call"
    )


def patch_guest_token_refresh(content: str) -> str:
    patterns = [
        re.compile(
            r"async function refreshGuestToken\\(\\) \\{\\s*"
            r"const newGuestToken = await fetchGuestToken\\(\\);\\s*"
            r"ourPort\\.emit\\("
            r"'guestToken',\\s*\\{\\s*guestToken:\\s*newGuestToken\\s*\\}"
            r"\\);\\s*"
            r"setTimeout\\("
            r"refreshGuestToken,\\s*"
            r"getGuestTokenRefreshTiming\\(newGuestToken\\)"
            r"\\);\\s*"
            r"\\}",
            re.DOTALL,
        ),
        re.compile(
            r"const refreshGuestToken = async \\(\\) => \\{\\s*"
            r"const newGuestToken = await fetchGuestToken\\(\\);\\s*"
            r"ourPort\\.emit\\("
            r"'guestToken',\\s*\\{\\s*guestToken:\\s*newGuestToken\\s*\\}"
            r"\\);\\s*"
            r"setTimeout\\("
            r"refreshGuestToken,\\s*"
            r"getGuestTokenRefreshTiming\\(newGuestToken\\)"
            r"\\);\\s*"
            r"\\};",
            re.DOTALL,
        ),
    ]

    replacement = """let activeDashboardId: string | undefined;

  async function refreshGuestToken() {
    const newGuestToken = await fetchGuestToken(
      activeDashboardId,
    );

    ourPort.emit('guestToken', {
      guestToken: newGuestToken,
    });

    setTimeout(
      refreshGuestToken,
      getGuestTokenRefreshTiming(newGuestToken),
    );
  }"""

    for pattern in patterns:
        updated, count = pattern.subn(
            replacement,
            content,
            count=1,
        )

        if count == 1:
            return updated

    raise PatchError(
        "Could not locate the guest-token refresh function"
    )


def patch_sdk_functions(content: str) -> str:
    anchor_candidates = [
        (
            "  const getScrollSize = () => "
            "ourPort.get<Size>('getScrollSize');"
        ),
        (
            "  const getScrollSize = () =>\\n"
            "    ourPort.get<Size>('getScrollSize');"
        ),
    ]

    switch_function = """  const switchDashboard = async (
    dashboardId: string,
  ): Promise<{
    dashboardId: string;
    accepted: true;
  }> => {
    const normalizedDashboardId = dashboardId.trim();

    if (!normalizedDashboardId) {
      throw new Error(
        'dashboardId must be a non-empty string',
      );
    }

    const guestToken = await fetchGuestToken(
      normalizedDashboardId,
    );

    const result = await ourPort.get<{
      dashboardId: string;
      accepted: true;
    }>('switchDashboard', {
      dashboardId: normalizedDashboardId,
      guestToken,
    });

    activeDashboardId = normalizedDashboardId;

    return result;
  };

"""

    for anchor in anchor_candidates:
        if content.count(anchor) == 1:
            return content.replace(
                anchor,
                switch_function + anchor,
                1,
            )

    raise PatchError(
        "Could not locate the SDK getScrollSize function"
    )


def patch_sdk_return_object(content: str) -> str:
    candidates = [
        "    setThemeMode,\\n  };",
        "    setThemeMode,\\n    unmount,\\n  };",
        "    unmount,\\n    setThemeMode,\\n  };",
    ]

    for candidate in candidates:
        if content.count(candidate) == 1:
            lines = candidate.splitlines()

            closing = lines.pop()
            body = "\\n".join(lines)

            return content.replace(
                candidate,
                body
                + "\\n"
                + "    switchDashboard,\\n"
                + closing,
                1,
            )

    raise PatchError(
        "Could not locate the EmbeddedDashboard return object"
    )


def patch_sdk(sdk_path: Path) -> None:
    content = sdk_path.read_text(encoding="utf-8")

    if "SUPERSET_SWITCHABLE_EMBED_SDK_PATCH" in content:
        print(f"Already patched: {sdk_path}")
        return

    content = patch_guest_token_fetch_type(content)
    content = patch_embedded_dashboard_type(content)
    content = patch_initial_guest_token_fetch(content)
    content = patch_guest_token_refresh(content)
    content = patch_sdk_functions(content)
    content = patch_sdk_return_object(content)

    sdk_path.write_text(content, encoding="utf-8")
    print(f"Patched: {sdk_path}")


def main() -> int:
    parser = argparse.ArgumentParser(
        description=(
            "Apply the switchable-dashboard patch to a "
            "Superset 6.1.x source checkout."
        )
    )

    parser.add_argument(
        "superset_root",
        type=Path,
        help="Path to the Apache Superset source checkout",
    )

    args = parser.parse_args()
    root = args.superset_root.resolve()

    frontend_path = root / FRONTEND_FILE
    sdk_path = root / SDK_FILE

    missing = [
        path
        for path in [frontend_path, sdk_path]
        if not path.exists()
    ]

    if missing:
        print(
            "The target does not appear to be a compatible "
            "Superset source checkout.",
            file=sys.stderr,
        )

        for missing_path in missing:
            print(f"Missing: {missing_path}", file=sys.stderr)

        return 2

    try:
        patch_frontend(frontend_path)
        patch_sdk(sdk_path)
    except PatchError as error:
        print(f"Patch failed: {error}", file=sys.stderr)
        return 1

    print("Patch completed successfully.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
`;

const VERIFY_PATCH_SH = `#!/usr/bin/env bash

set -euo pipefail

SUPERSET_ROOT=\${1:?Usage: verify_patch.sh /path/to/superset}

FRONTEND_FILE="$SUPERSET_ROOT/superset-frontend/src/embedded/index.tsx"
SDK_FILE="$SUPERSET_ROOT/superset-embedded-sdk/src/index.ts"

test -f "$FRONTEND_FILE"
test -f "$SDK_FILE"

grep -q \\
  "SUPERSET_SWITCHABLE_EMBED_PATCH" \\
  "$FRONTEND_FILE"

grep -q \\
  "'switchDashboard'" \\
  "$FRONTEND_FILE"

grep -q \\
  "dashboardSwitchHandler" \\
  "$FRONTEND_FILE"

grep -q \\
  "SUPERSET_SWITCHABLE_EMBED_SDK_PATCH" \\
  "$SDK_FILE"

grep -q \\
  "switchDashboard:" \\
  "$SDK_FILE"

grep -q \\
  "activeDashboardId" \\
  "$SDK_FILE"

grep -q \\
  "fetchGuestToken(" \\
  "$SDK_FILE"

echo "The switchable-dashboard patch is present."
`;

const BUILD_SDK_SH = `#!/usr/bin/env bash

set -euo pipefail

SUPERSET_ROOT=\${1:?Usage: build-sdk.sh /path/to/superset}

SDK_ROOT="$SUPERSET_ROOT/superset-embedded-sdk"

if [ ! -f "$SDK_ROOT/package.json" ]; then
  echo "Missing SDK package: $SDK_ROOT" >&2
  exit 1
fi

cd "$SDK_ROOT"

npm ci

npm run build

echo
echo "Embedded SDK build completed."
echo "Output directory:"
find . \\
  -maxdepth 2 \\
  -type d \\
  \\( -name dist -o -name lib \\) \\
  -print
`;

const BUILD_FRONTEND_SH = `#!/usr/bin/env bash

set -euo pipefail

SUPERSET_ROOT=\${1:?Usage: build-superset-frontend.sh /path/to/superset}

FRONTEND_ROOT="$SUPERSET_ROOT/superset-frontend"

if [ ! -f "$FRONTEND_ROOT/package.json" ]; then
  echo "Missing Superset frontend: $FRONTEND_ROOT" >&2
  exit 1
fi

cd "$FRONTEND_ROOT"

npm ci

npm run build

echo "Superset frontend build completed."
`;

const PATCH_AND_BUILD_SH = `#!/usr/bin/env bash

set -euo pipefail

SUPERSET_ROOT=\${1:?Usage: patch-and-build.sh /path/to/superset}

SCRIPT_DIR=$(
  cd "$(dirname "\${BASH_SOURCE[0]}")"
  pwd
)

PROJECT_ROOT=$(
  cd "$SCRIPT_DIR/.."
  pwd
)

python3 \\
  "$PROJECT_ROOT/patches/apply_superset_6_1_patch.py" \\
  "$SUPERSET_ROOT"

"$PROJECT_ROOT/patches/verify_patch.sh" \\
  "$SUPERSET_ROOT"

"$SCRIPT_DIR/build-sdk.sh" \\
  "$SUPERSET_ROOT"

"$SCRIPT_DIR/build-superset-frontend.sh" \\
  "$SUPERSET_ROOT"

echo
echo "Patch and frontend builds completed."
`;

const BUILD_DOCKER_SH = `#!/usr/bin/env bash

set -euo pipefail

SUPERSET_ROOT=\${1:?Usage: build-docker-image.sh /path/to/superset [image-tag]}
IMAGE_TAG=\${2:-local/superset-switchable:6.1.0}

SCRIPT_DIR=$(
  cd "$(dirname "\${BASH_SOURCE[0]}")"
  pwd
)

PROJECT_ROOT=$(
  cd "$SCRIPT_DIR/.."
  pwd
)

python3 \\
  "$PROJECT_ROOT/patches/apply_superset_6_1_patch.py" \\
  "$SUPERSET_ROOT"

"$PROJECT_ROOT/patches/verify_patch.sh" \\
  "$SUPERSET_ROOT"

cd "$SUPERSET_ROOT"

docker build \\
  --target lean \\
  --tag "$IMAGE_TAG" \\
  .

echo "Built Docker image: $IMAGE_TAG"
`;

const README = `# ${SUPERSET_PLUGIN_ID}

Multi-tenant, org-agnostic Superset dashboard embed plugin (patch-and-build strategy).

This is not a generated plugin like the Kibana variant. Instead, Decaf holds
patch scripts that modify Superset's internal embedded frontend and embedded
SDK source files to add a \`switchDashboard\` method. The existing iframe
element, document, contentWindow, React runtime, and Switchboard MessageChannel
are preserved across dashboard switches.

## What it patches

- \`superset-frontend/src/embedded/index.tsx\` — adds \`switchDashboard\` to the
  Switchboard channel; replaces only \`DashboardPage\`.
- \`superset-embedded-sdk/src/index.ts\` — adds
  \`embeddedDashboard.switchDashboard(dashboardId)\`; requests a guest token for
  the selected dashboard; refreshes future guest tokens for the active dashboard.

## Build

\`\`\`bash
# Apply patch + verify + build SDK + build frontend
build/patch-and-build.sh /path/to/superset

# Or build a Docker image
build/build-docker-image.sh /path/to/superset registry.example.com/superset-switchable:6.1.0
\`\`\`

The patched SDK must be packed and installed into the Angular application:

\`\`\`bash
cd /path/to/superset/superset-embedded-sdk
npm ci && npm run build && npm pack
cd /path/to/angular-app
npm install /path/to/superset/superset-embedded-sdk/superset-ui-embedded-sdk-*.tgz
\`\`\`

Version: ${SUPERSET_PLUGIN_VERSION}
`;

/**
 * Returns the full set of patch and build script files.
 */
export function supersetPatchFiles(): SupersetPatchFile[] {
  return [
    { path: "patches/apply_superset_6_1_patch.py", content: APPLY_PATCH_PY, executable: true },
    { path: "patches/verify_patch.sh", content: VERIFY_PATCH_SH, executable: true },
    { path: "build/build-sdk.sh", content: BUILD_SDK_SH, executable: true },
    { path: "build/build-superset-frontend.sh", content: BUILD_FRONTEND_SH, executable: true },
    { path: "build/patch-and-build.sh", content: PATCH_AND_BUILD_SH, executable: true },
    { path: "build/build-docker-image.sh", content: BUILD_DOCKER_SH, executable: true },
    { path: "README.md", content: README },
  ];
}
