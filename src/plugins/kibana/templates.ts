/**
 * @module integrations/plugins/kibana/templates
 * @summary Version-parameterized source templates for the Kibana embed plugin.
 * @description Holds the generated plugin source as string templates. These
 * are materialized onto disk by the installer. The source is the reference
 * multi-tenant embed plugin preserved in DECAF-40 §8. There is never space
 * switching; the plugin is org-agnostic and the current Kibana space comes
 * from the request/session/proxy context.
 */
import { KIBANA_APP_ID, KIBANA_PLUGIN_ID, KIBANA_PLUGIN_VERSION } from "./manifest";

export interface KibanaPluginFile {
  /** Relative path within the plugin directory. */
  path: string;
  /** File contents. */
  content: string;
}

const TS_CONFIG = `{
  "extends": "../../tsconfig.json",
  "include": ["public/**/*", "server/**/*"]
}
`;

const PUBLIC_TYPES = `import type {
  AppMountParameters,
  CoreSetup,
  CoreStart,
  Plugin
} from '@kbn/core/public';

import type { DashboardStart } from '@kbn/dashboard-plugin/public';
import type { EmbeddableStart } from '@kbn/embeddable-plugin/public';
import type { DataPublicPluginStart } from '@kbn/data-plugin/public';

export interface OrgDashboardEmbedSetupDeps {}

export interface OrgDashboardEmbedStartDeps {
  dashboard: DashboardStart;
  embeddable: EmbeddableStart;
  data: DataPublicPluginStart;
}

export type OrgDashboardEmbedPlugin = Plugin<
  void,
  void,
  OrgDashboardEmbedSetupDeps,
  OrgDashboardEmbedStartDeps
>;

export interface MountAppArgs {
  coreStart: CoreStart;
  depsStart: OrgDashboardEmbedStartDeps;
  params: AppMountParameters;
}
`;

const PUBLIC_INDEX = `import type { OrgDashboardEmbedPlugin } from './types';
import { OrgDashboardEmbedPluginImpl } from './plugin';

export function plugin(): OrgDashboardEmbedPlugin {
  return new OrgDashboardEmbedPluginImpl();
}
`;

const PUBLIC_PLUGIN = `import React from 'react';
import ReactDOM from 'react-dom';

import type { CoreSetup, CoreStart } from '@kbn/core/public';
import type {
  OrgDashboardEmbedPlugin,
  OrgDashboardEmbedSetupDeps,
  OrgDashboardEmbedStartDeps
} from './types';

export class OrgDashboardEmbedPluginImpl implements OrgDashboardEmbedPlugin {
  public setup(
    core: CoreSetup<OrgDashboardEmbedStartDeps>,
    deps: OrgDashboardEmbedSetupDeps
  ) {
    core.application.register({
      id: '${KIBANA_APP_ID}',
      title: 'Dashboard Embed',
      chromeless: true,
      visibleIn: [],
      async mount(params) {
        const [coreStart, depsStart] = await core.getStartServices();
        const { OrgDashboardEmbedApp } = await import('./application');

        ReactDOM.render(
          <OrgDashboardEmbedApp
            coreStart={coreStart}
            depsStart={depsStart}
            params={params}
          />,
          params.element
        );

        return () => ReactDOM.unmountComponentAtNode(params.element);
      }
    });
  }

  public start(core: CoreStart, deps: OrgDashboardEmbedStartDeps) {}

  public stop() {}
}
`;

const PUBLIC_APPLICATION = `import React, { useCallback, useEffect, useRef, useState } from 'react';
import type { MountAppArgs } from './types';

type DashboardQuery = {
  language: 'kuery' | 'lucene';
  query: string;
};

type DashboardTimeRange = {
  from: string;
  to: string;
};

type SwitchDashboardMessage = {
  type: 'ORG_DASHBOARD_EMBED_SWITCH_DASHBOARD';
  dashboardId: string;
  timeRange?: DashboardTimeRange;
  query?: DashboardQuery;
  filters?: unknown[];
};

type ParentReadyMessage = {
  type: 'ORG_DASHBOARD_EMBED_READY';
  dashboardId: string | null;
};

type ParentRenderedMessage = {
  type: 'ORG_DASHBOARD_EMBED_RENDERED';
  dashboardId: string;
};

type ParentErrorMessage = {
  type: 'ORG_DASHBOARD_EMBED_ERROR';
  dashboardId: string | null;
  message: string;
};

type ParentMessage =
  | ParentReadyMessage
  | ParentRenderedMessage
  | ParentErrorMessage;

const DEFAULT_ALLOWED_PARENT_ORIGINS: string[] = [
  window.location.origin
];

function getInitialDashboardId(): string | null {
  const params = new URLSearchParams(window.location.search);
  return params.get('dashboardId');
}

function getAllowedParentOrigins(): string[] {
  const params = new URLSearchParams(window.location.search);
  const raw = params.get('parentOrigin');

  if (!raw) {
    return DEFAULT_ALLOWED_PARENT_ORIGINS;
  }

  try {
    const decoded = decodeURIComponent(raw);
    const origins = decoded
      .split(',')
      .map((origin) => origin.trim())
      .filter(Boolean);

    return origins.length > 0 ? origins : DEFAULT_ALLOWED_PARENT_ORIGINS;
  } catch {
    return DEFAULT_ALLOWED_PARENT_ORIGINS;
  }
}

function isSwitchDashboardMessage(data: unknown): data is SwitchDashboardMessage {
  if (!data || typeof data !== 'object') {
    return false;
  }

  const message = data as Partial<SwitchDashboardMessage>;

  return (
    message.type === 'ORG_DASHBOARD_EMBED_SWITCH_DASHBOARD' &&
    typeof message.dashboardId === 'string' &&
    message.dashboardId.length > 0
  );
}

function postToParent(message: ParentMessage, targetOrigin: string) {
  window.parent.postMessage(message, targetOrigin);
}

export function OrgDashboardEmbedApp({
  coreStart,
  depsStart
}: MountAppArgs) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const mountedDashboardRef = useRef<any>(null);
  const allowedParentOriginsRef = useRef<string[]>(getAllowedParentOrigins());
  const lastParentOriginRef = useRef<string>(window.location.origin);

  const [dashboardId, setDashboardId] = useState<string | null>(
    getInitialDashboardId()
  );

  const [loading, setLoading] = useState(false);

  useEffect(() => {
    coreStart.chrome.setIsVisible(false);
  }, [coreStart]);

  const destroyCurrentDashboard = useCallback(() => {
    if (mountedDashboardRef.current?.destroy) {
      mountedDashboardRef.current.destroy();
    }

    mountedDashboardRef.current = null;

    if (rootRef.current) {
      rootRef.current.innerHTML = '';
    }
  }, []);

  const applySharedDashboardState = useCallback(
    (message: SwitchDashboardMessage) => {
      if (message.timeRange) {
        depsStart.data.query.timefilter.timefilter.setTime(message.timeRange);
      }

      if (message.query) {
        depsStart.data.query.queryString.setQuery(message.query);
      }

      if (message.filters) {
        depsStart.data.query.filterManager.setFilters(message.filters as any);
      }
    },
    [depsStart.data]
  );

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (!allowedParentOriginsRef.current.includes(event.origin)) {
        return;
      }

      if (!isSwitchDashboardMessage(event.data)) {
        return;
      }

      lastParentOriginRef.current = event.origin;

      applySharedDashboardState(event.data);
      setDashboardId(event.data.dashboardId);
    };

    window.addEventListener('message', onMessage);

    postToParent(
      {
        type: 'ORG_DASHBOARD_EMBED_READY',
        dashboardId
      },
      lastParentOriginRef.current
    );

    return () => window.removeEventListener('message', onMessage);
  }, [applySharedDashboardState, dashboardId]);

  useEffect(() => {
    if (!dashboardId || !rootRef.current) {
      return;
    }

    let cancelled = false;

    async function renderDashboard() {
      setLoading(true);

      try {
        destroyCurrentDashboard();

        const factory =
          depsStart.embeddable.getEmbeddableFactory?.('dashboard') ||
          depsStart.embeddable.getEmbeddableFactory?.('dashboard_container');

        if (!factory) {
          throw new Error('Kibana dashboard embeddable factory was not found.');
        }

        const embeddable = await factory.create({
          id: dashboardId,
          savedObjectId: dashboardId,
          viewMode: 'view',
          hidePanelTitles: false,
          useMargins: true,
          syncColors: true,
          syncCursor: true,
          syncTooltips: true,
          timeRange: depsStart.data.query.timefilter.timefilter.getTime(),
          query: depsStart.data.query.queryString.getQuery(),
          filters: depsStart.data.query.filterManager.getFilters()
        } as any);

        if (cancelled) {
          embeddable.destroy?.();
          return;
        }

        embeddable.render(rootRef.current!);
        mountedDashboardRef.current = embeddable;

        postToParent(
          {
            type: 'ORG_DASHBOARD_EMBED_RENDERED',
            dashboardId
          },
          lastParentOriginRef.current
        );
      } catch (error) {
        const message =
          error instanceof Error ? error.message : 'Unknown dashboard error';

        if (rootRef.current) {
          rootRef.current.innerHTML = \`
            <div style="
              padding: 24px;
              font-family: sans-serif;
              color: #bd271e;
            ">
              Failed to render dashboard: \${message}
            </div>
          \`;
        }

        postToParent(
          {
            type: 'ORG_DASHBOARD_EMBED_ERROR',
            dashboardId,
            message
          },
          lastParentOriginRef.current
        );
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    renderDashboard();

    return () => {
      cancelled = true;
    };
  }, [dashboardId, depsStart, destroyCurrentDashboard]);

  useEffect(() => {
    return () => {
      destroyCurrentDashboard();
    };
  }, [destroyCurrentDashboard]);

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        width: '100vw',
        height: '100vh',
        overflow: 'hidden',
        background: '#fff'
      }}
    >
      {loading && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            zIndex: 10,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontFamily: 'sans-serif',
            background: '#fff'
          }}
        >
          Loading dashboard…
        </div>
      )}

      <div
        ref={rootRef}
        style={{
          position: 'absolute',
          inset: 0,
          width: '100%',
          height: '100%'
        }}
      />
    </div>
  );
}
`;

const SERVER_INDEX = `import type { PluginInitializerContext } from '@kbn/core/server';
import { OrgDashboardEmbedServerPlugin } from './plugin';

export function plugin(initializerContext: PluginInitializerContext) {
  return new OrgDashboardEmbedServerPlugin(initializerContext);
}
`;

const SERVER_PLUGIN = `import type {
  CoreSetup,
  CoreStart,
  Plugin,
  PluginInitializerContext
} from '@kbn/core/server';

export class OrgDashboardEmbedServerPlugin implements Plugin {
  constructor(private readonly initializerContext: PluginInitializerContext) {}

  public setup(core: CoreSetup) {
    const router = core.http.createRouter();

    router.get(
      {
        path: '/api/${KIBANA_APP_ID}/health',
        validate: false
      },
      async (context, request, response) => {
        return response.ok({
          body: {
            ok: true,
            plugin: '${KIBANA_APP_ID}'
          }
        });
      }
    );
  }

  public start(core: CoreStart) {}

  public stop() {}
}
`;

const README = `# ${KIBANA_PLUGIN_ID}

Multi-tenant, org-agnostic Kibana dashboard embed plugin.

There is never space switching. Each org already lands in its own Kibana space
through the backend proxy/session URL, and the plugin only switches dashboards
within the current space.

## Build

Kibana plugins must match the exact Kibana version and must be built within the
Kibana repo (see kbn-plugin-generator). Place this directory under
\`kibana-extra/\` (or \`plugins/\`) and run the Kibana plugin build, e.g.:

\`\`\`
yarn build
\`\`\`

## Embed URL

\`\`\`
/kibana/app/${KIBANA_APP_ID}?dashboardId=<id>&parentOrigin=<origin>
\`\`\`

## Message protocol

- Parent -> plugin: \`ORG_DASHBOARD_EMBED_SWITCH_DASHBOARD\`
- Plugin -> parent: \`ORG_DASHBOARD_EMBED_READY\` / \`ORG_DASHBOARD_EMBED_RENDERED\` / \`ORG_DASHBOARD_EMBED_ERROR\`

Version: ${KIBANA_PLUGIN_VERSION}
`;

/**
 * Returns the full set of generated plugin files for a target Kibana version.
 *
 * @param targetVersion - Kibana version baked into `kibana.json`.
 */
export function kibanaPluginFiles(targetVersion: string): KibanaPluginFile[] {
  const manifest = JSON.stringify(
    {
      id: KIBANA_PLUGIN_ID,
      version: KIBANA_PLUGIN_VERSION,
      kibanaVersion: targetVersion,
      server: true,
      ui: true,
      requiredPlugins: ["dashboard", "embeddable", "data"],
      optionalPlugins: [],
    },
    null,
    2
  );

  return [
    { path: "kibana.json", content: `${manifest}\n` },
    { path: "tsconfig.json", content: `${TS_CONFIG}\n` },
    { path: "README.md", content: README },
    { path: "public/types.ts", content: PUBLIC_TYPES },
    { path: "public/index.ts", content: PUBLIC_INDEX },
    { path: "public/plugin.tsx", content: PUBLIC_PLUGIN },
    { path: "public/application.tsx", content: PUBLIC_APPLICATION },
    { path: "server/index.ts", content: SERVER_INDEX },
    { path: "server/plugin.ts", content: SERVER_PLUGIN },
  ];
}
