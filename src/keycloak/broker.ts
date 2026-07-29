import { createHash } from "node:crypto";

/**
 * Returns the stable local lookup key for an identity received from a broker.
 * Email and username are deliberately excluded because they can change.
 */
export function getBrokerExternalIdentityKey(
  issuer: string,
  subject: string
): string {
  if (!issuer.trim() || !subject.trim()) {
    throw new Error("Broker issuer and subject are required");
  }
  return createHash("sha256")
    .update(`${issuer}\n${subject}`, "utf8")
    .digest("hex");
}

export function isLocalKeycloakIssuer(
  issuer: string,
  expectedIssuer: string
): boolean {
  return issuer.replace(/\/$/, "") === expectedIssuer.replace(/\/$/, "");
}
