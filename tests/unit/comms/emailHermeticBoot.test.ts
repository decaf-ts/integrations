/**
 * @module integrations/tests/unit/comms/emailHermeticBoot
 * @summary SAA-1313 (SAA-1309 / SAA-1305 finding F1): regression coverage for
 * hermetic node-path booting. The node boot helper must ignore the
 * `comms.email` environment slice so a plaintext-AUTH opt-in that only lives
 * in the environment cannot reach an undecorated email service booted with an
 * explicit config.
 * @description Seeds the real `process.env` slice for each case (the
 * `@decaf-ts/logging` Environment reads `process.env` at access time), asserts
 * the slice is live, then boots via `bootWithoutEnvironment` and inspects the
 * resolved service config.
 */
import { describe, it, expect, afterEach } from "@jest/globals";
import { EmailService } from "../../../src/comms/email/EmailService";
import { bootWithoutEnvironment } from "../../../src/shared/http";

const ALLOW_PLAINTEXT_AUTH_ENV = "COMMS__EMAIL__ALLOW_PLAINTEXT_AUTH";
const HOST_ENV = "COMMS__EMAIL__HOST";

const EXPLICIT_CONFIG = {
  provider: "smtp" as const,
  host: "explicit.smtp.example",
  port: 2525,
  username: "user@example.com",
  password: "secret",
  from: "sender@example.com",
};

describe("EmailService hermetic node boot (SAA-1305 F1)", () => {
  afterEach(() => {
    delete process.env[ALLOW_PLAINTEXT_AUTH_ENV];
    delete process.env[HOST_ENV];
  });

  it("ignores the environment plaintext-AUTH opt-in when an explicit config is supplied", async () => {
    process.env[ALLOW_PLAINTEXT_AUTH_ENV] = "true";
    process.env[HOST_ENV] = "env.smtp.example";

    const service = new EmailService();

    const envSlice = (
      service as unknown as {
        configFromEnvironment(): { allowPlaintextAuth?: boolean } | undefined;
      }
    ).configFromEnvironment();
    expect(envSlice?.allowPlaintextAuth).toBe(true);

    await bootWithoutEnvironment(service, { ...EXPLICIT_CONFIG });

    const resolved = (
      service as unknown as {
        config: {
          host?: string;
          port?: number;
          allowPlaintextAuth?: boolean;
        };
      }
    ).config;
    expect(resolved.host).toBe("explicit.smtp.example");
    expect(resolved.port).toBe(2525);
    expect(resolved.allowPlaintextAuth).toBe(false);

    const restoredSlice = (
      service as unknown as {
        configFromEnvironment(): { allowPlaintextAuth?: boolean } | undefined;
      }
    ).configFromEnvironment();
    expect(restoredSlice?.allowPlaintextAuth).toBe(true);
  });
});
