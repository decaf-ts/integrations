/**
 * @module integrations/plugins
 * @summary BI dashboard embed plugin surface.
 * @description Aggregates the shared DOM-free contract and both BI tool
 * plugins (Kibana + Superset). Both plugins implement the exact same
 * `DashboardEmbedPlugin` API.
 *
 * - **Kibana:** generated plugin source + installer (writes files, optional build).
 * - **Superset:** patch-and-build strategy (patches Superset's internal source,
 *   builds SDK + frontend + optionally Docker image).
 *
 * Both are org-agnostic: there is never space switching. The current BI space
 * comes from the request/session/proxy context, not from the plugin.
 */
export * from "./contract";
export * from "./kibana";
export * from "./superset";
