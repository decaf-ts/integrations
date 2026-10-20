/**
 * @module integrations/comms/email
 * @summary Email service (SMTP + Microsoft Graph send, Graph/IMAP inbox reads).
 * @description Re-exports the {@link EmailService} and its config/result
 * types, the raw MIME builder, the non-Environment {@link EmailNodeService},
 * and the nodemailer-backed {@link SmtpClient} with its {@link SmtpConfig}
 * (also available directly from the `./smtp` subpath).
 */
export * from "./EmailService";
export * from "./EmailNodeService";
export * from "./mime";
export * from "./smtp";
