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
 *
 * Every address, attachment filename, and content type is validated against
 * conservative allowlists ({@link assertEmailAddress} and friends) before it is
 * written into a header, so workflow input can never inject MIME headers or
 * SMTP commands. All validation and structural failures (missing recipient,
 * forbidden control characters, non-mailbox addresses, unsafe filenames or
 * content types) throw decaf `BadRequestError`s.
 */
import { randomUUID } from "node:crypto";
import { BadRequestError } from "@decaf-ts/db-decorators";

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
 * Characters that must never appear in an address, attachment filename, or
 * content type: CR/LF (header and SMTP-command injection), NUL, and any other
 * C0/C1 control character.
 */
// eslint-disable-next-line no-control-regex -- matching control characters is the purpose of this allowlist
const FORBIDDEN_CONTROL = /[\x00-\x1F\x7F-\x9F]/;

/**
 * Conservative mailbox allowlist: a dot-atom local part followed by a
 * dot-separated domain. Display names are deliberately not accepted because
 * the envelope (`MAIL FROM`/`RCPT TO`) and the MIME headers share the same
 * validated value.
 */
const EMAIL_ADDRESS =
  /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$/;

/**
 * Allowlisted MIME content type: `type/subtype` plus optional
 * `; parameter=value` pairs whose values are tokens or quoted strings without
 * control characters, quotes, or backslashes.
 */
const CONTENT_TYPE =
  /^[A-Za-z0-9!#$&^_.+-]+\/[A-Za-z0-9!#$&^_.+-]+(?:\s*;\s*[A-Za-z0-9-]+=(?:"[^"\\\r\n]*"|[A-Za-z0-9!#$&^_.+-]+))*$/;

/**
 * Rejects any value carrying CR/LF, NUL, or another control character.
 *
 * @param value - Value about to be written into a header, SMTP command, or MIME part.
 * @param field - Human-readable field name used in the error message.
 * @throws {BadRequestError} when the value contains a forbidden control character.
 */
function rejectControlCharacters(value: string, field: string): void {
  if (FORBIDDEN_CONTROL.test(value)) {
    throw new BadRequestError(
      `Email ${field} contains a forbidden control character`
    );
  }
}

/**
 * Validates a mailbox address against the allowlist and returns it trimmed.
 *
 * @param value - Candidate address.
 * @param field - Human-readable field name used in the error message.
 * @returns The trimmed, validated mailbox address.
 * @throws {BadRequestError} when the address contains control characters or is not a bare mailbox.
 */
export function assertEmailAddress(
  value: string,
  field = "address"
): string {
  rejectControlCharacters(value, field);
  const address = value.trim();
  if (!EMAIL_ADDRESS.test(address)) {
    throw new BadRequestError(`Email ${field} is not a valid mailbox address`);
  }
  return address;
}

/**
 * Validates an attachment filename for safe inclusion in a quoted MIME header.
 *
 * @param value - Candidate filename.
 * @throws {BadRequestError} when the filename carries control characters, a quote, or a backslash.
 */
function assertAttachmentFilename(value: string): void {
  rejectControlCharacters(value, "attachment filename");
  if (/["\\]/.test(value)) {
    throw new BadRequestError(
      "Email attachment filename contains a forbidden character"
    );
  }
}

/**
 * Validates an attachment content type against the MIME allowlist.
 *
 * @param value - Declared content type.
 * @throws {BadRequestError} when the value is not an allowlisted `type/subtype` with safe parameters.
 */
function assertContentType(value: string): void {
  rejectControlCharacters(value, "attachment content type");
  if (!CONTENT_TYPE.test(value.trim())) {
    throw new BadRequestError(
      "Email attachment content type is not an allowed MIME type"
    );
  }
}

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
 * @description Normalizes a recipient input into an allowlisted address list
 * @summary Splits comma-separated strings, trims entries, drops empties, and
 * validates every remaining entry as a bare mailbox address. Values carrying
 * CR/LF, NUL, or other control characters are rejected outright so workflow
 * input can never inject MIME headers or SMTP envelope commands.
 * @param value - Single address, comma-separated string, array, or `undefined`
 * @returns The trimmed, validated list of addresses
 * @throws {BadRequestError} when an entry is not a valid mailbox address
 */
export function parseAddressList(
  value: string | string[] | undefined
): string[] {
  if (!value) return [];
  const values = Array.isArray(value) ? value : [value];
  return values
    .flatMap((entry) => entry.split(","))
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)
    .map((entry) => assertEmailAddress(entry, "recipient"));
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
  assertAttachmentFilename(attachment.filename);
  assertContentType(contentType);
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
 * @throws {BadRequestError} when the message has no recipient or any address,
 *   attachment filename, or content type fails validation
 */
export function buildEmail(input: EmailMessageInput): BuiltEmail {
  const messageId = `<${randomUUID()}@as-graph>`;
  const from = assertEmailAddress(input.from, "sender");
  const to = parseAddressList(input.to);
  const cc = parseAddressList(input.cc);
  const bcc = parseAddressList(input.bcc);
  const recipients = [...to, ...cc, ...bcc];
  if (recipients.length === 0) {
    throw new BadRequestError(
      "Email message requires at least one recipient"
    );
  }
  const replyTo = input.replyTo
    ? assertEmailAddress(input.replyTo, "reply-to")
    : undefined;
  const headers = [
    `From: ${from}`,
    `To: ${to.join(", ")}`,
    ...(cc.length ? [`Cc: ${cc.join(", ")}`] : []),
    `Subject: ${encodeHeader(input.subject)}`,
    ...(replyTo ? [`Reply-To: ${replyTo}`] : []),
    `Date: ${new Date().toUTCString()}`,
    `Message-ID: ${messageId}`,
    "MIME-Version: 1.0",
  ].join("\r\n");
  return {
    raw: `${headers}\r\n${entity(input)}`,
    from,
    recipients,
    messageId,
  };
}
