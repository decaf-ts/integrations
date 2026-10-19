/**
 * @module integrations/comms/email/mime
 * @summary RFC 5322/MIME message building and address handling for the Email service.
 * @description Builds a complete raw MIME message from an
 * {@link EmailMessageInput}: UTF-8 headers are RFC 2047 base64-word encoded
 * ({@link encodeHeader}), recipient lists are comma-split and trimmed
 * ({@link parseAddressList}), and the body becomes a
 * `text/plain`/`text/html` `multipart/alternative` (when both are present),
 * a single part otherwise — wrapped in `multipart/mixed` with base64
 * attachments when any are supplied. Boundary markers and the `Message-ID`
 * carry a random UUID per message.
 */
import { randomUUID } from "node:crypto";

/**
 * @description A message attachment
 * @summary Content is base64 text by default; with `encoding: "utf8"` the
 * builder base64-encodes the UTF-8 content itself.
 * @category Comms
 * @memberOf module:integrations/comms/email/mime
 */
export interface EmailAttachment {
  filename: string;
  content: string;
  encoding?: "base64" | "utf8";
  contentType?: string;
}

/**
 * @description Input for building a raw MIME message
 * @summary Carries the sender, recipients (single address, comma-separated
 * string, or array), subject, optional text and HTML bodies, `Reply-To`, and
 * attachments.
 * @category Comms
 * @memberOf module:integrations/comms/email/mime
 */
export interface EmailMessageInput {
  from: string;
  to: string | string[];
  cc?: string | string[];
  bcc?: string | string[];
  subject: string;
  text?: string;
  html?: string;
  replyTo?: string;
  attachments?: EmailAttachment[];
}

/**
 * @description The built MIME message ready for delivery
 * @summary Carries the raw RFC 5322 text, the resolved sender, the flattened
 * recipient list (To/Cc/Bcc), and the generated `Message-ID`.
 * @category Comms
 * @memberOf module:integrations/comms/email/mime
 */
export interface BuiltEmail {
  raw: string;
  from: string;
  recipients: string[];
  messageId: string;
}

const ASCII_HEADER = /^[\x20-\x7E]*$/;

/**
 * @description Encodes a MIME header value safely
 * @summary Pure-ASCII values pass through; anything else becomes an RFC 2047
 * `=?UTF-8?B?...?=` encoded word.
 * @param value - Raw header value
 * @returns The header value safe for raw message transport
 */
export function encodeHeader(value: string): string {
  if (ASCII_HEADER.test(value)) return value;
  return `=?UTF-8?B?${Buffer.from(value, "utf8").toString("base64")}?=`;
}

/**
 * @description Normalizes a recipient input into an address list
 * @summary Splits comma-separated strings, trims entries, and drops empties.
 * @param value - Single address, comma-separated string, array, or `undefined`
 * @returns The trimmed list of addresses
 */
export function parseAddressList(
  value: string | string[] | undefined
): string[] {
  if (!value) return [];
  const values = Array.isArray(value) ? value : [value];
  return values
    .flatMap((entry) => entry.split(","))
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

function base64Lines(value: string): string {
  return Buffer.from(value, "utf8")
    .toString("base64")
    .replace(/(.{76})/g, "$1\r\n");
}

function textPart(contentType: string, value: string): string {
  return `Content-Type: ${contentType}; charset=utf-8\r\nContent-Transfer-Encoding: base64\r\n\r\n${base64Lines(
    value
  )}`;
}

function bodyEntity(input: EmailMessageInput): string {
  if (input.text !== undefined && input.html !== undefined) {
    const boundary = `alt-${randomUUID()}`;
    return [
      `Content-Type: multipart/alternative; boundary="${boundary}"`,
      "",
      `--${boundary}`,
      textPart("text/plain", input.text),
      `--${boundary}`,
      textPart("text/html", input.html),
      `--${boundary}--`,
    ].join("\r\n");
  }
  if (input.html !== undefined) {
    return textPart("text/html", input.html);
  }
  return textPart("text/plain", input.text ?? "");
}

function attachmentPart(attachment: EmailAttachment): string {
  const content =
    attachment.encoding === "utf8"
      ? base64Lines(attachment.content)
      : attachment.content.replace(/\r?\n/g, "");
  const contentType = attachment.contentType ?? "application/octet-stream";
  return [
    `Content-Type: ${contentType}; name="${encodeHeader(attachment.filename)}"`,
    "Content-Transfer-Encoding: base64",
    `Content-Disposition: attachment; filename="${encodeHeader(
      attachment.filename
    )}"`,
    "",
    content,
  ].join("\r\n");
}

function entity(input: EmailMessageInput): string {
  const attachments = input.attachments ?? [];
  if (attachments.length === 0) return bodyEntity(input);
  const boundary = `mix-${randomUUID()}`;
  const parts = [bodyEntity(input), ...attachments.map(attachmentPart)];
  return `Content-Type: multipart/mixed; boundary="${boundary}"\r\n\r\n${parts
    .map((part) => `--${boundary}\r\n${part}`)
    .join("\r\n")}\r\n--${boundary}--`;
}

/**
 * @description Builds the complete raw MIME message
 * @summary Generates the `Message-ID`, resolves recipients (throwing when
 * none remain), emits the standard headers, and assembles the body entity
 * (alternative text/HTML parts, plus attachments when present).
 * @param input - Message input
 * @returns The built message with raw text, sender, recipients, and `Message-ID`
 * @throws {Error} when the message has no recipient
 */
export function buildEmail(input: EmailMessageInput): BuiltEmail {
  const messageId = `<${randomUUID()}@as-graph>`;
  const to = parseAddressList(input.to);
  const cc = parseAddressList(input.cc);
  const bcc = parseAddressList(input.bcc);
  const recipients = [...to, ...cc, ...bcc];
  if (recipients.length === 0) {
    throw new Error("Email message requires at least one recipient");
  }
  const headers = [
    `From: ${input.from}`,
    `To: ${to.join(", ")}`,
    ...(cc.length ? [`Cc: ${cc.join(", ")}`] : []),
    `Subject: ${encodeHeader(input.subject)}`,
    ...(input.replyTo ? [`Reply-To: ${input.replyTo}`] : []),
    `Date: ${new Date().toUTCString()}`,
    `Message-ID: ${messageId}`,
    "MIME-Version: 1.0",
  ].join("\r\n");
  return {
    raw: `${headers}\r\n${entity(input)}`,
    from: input.from,
    recipients,
    messageId,
  };
}
