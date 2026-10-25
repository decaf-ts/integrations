/**
 * @module integrations/comms
 * @summary Comms integration services (Slack, Telegram, Teams, Gmail, Email).
 * @description Re-exports the messaging/email services, their per-service
 * modules, and the shared `comms` environment slice. Each sub-module is also
 * available through its own package subpath export.
 */
export * from "./email";
export * from "./gmail";
export * from "./slack";
export * from "./teams";
export * from "./telegram";
export * from "./discord";
export * from "./whatsapp";
export * from "./outlook";
export * from "./environment";
