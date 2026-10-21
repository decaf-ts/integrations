/**
 * @module integrations/tests/namespaces/rls-session-binding
 * @summary Unit coverage for the namespace RLS session-binding resolver.
 * @description Verifies that {@link namespaceRlsSessionBinding} maps a decaf
 * `principals.id` UUID from the execution context onto the RLS session setting
 * the namespace policies read, fails closed when no valid principal is
 * available, warns once (without leaking the offending value) for an
 * authenticated-but-unresolved context, honors custom context keys, and that
 * {@link namespaceRlsTypeORMOptions} exposes the resolver as adapter options.
 * Also pins the RLS template to `RLS_SETTINGS.Principal` as the single source
 * of truth for the `app.principal_id` helper.
 */
import { Context } from "@decaf-ts/core";
import { RLS_SETTINGS } from "../../../src/namespaces/rls/rls.constants";
import { RLS_FUNCTION_STATEMENTS } from "../../../src/namespaces/rls/rls.template";
import {
  namespaceRlsSessionBinding,
  namespaceRlsTypeORMOptions,
} from "../../../src/namespaces/rls/session-binding";

const PRINCIPAL_ID = "10000000-0000-4000-8000-0000000000b1";
const SUBJECT = "subject-user@example.test";

function context(values: Record<string, unknown>): Context {
  return (new Context() as any).accumulate(values) as Context;
}

function collectWarnings(): {
  warnings: string[];
  warn: (message: string) => void;
} {
  const warnings: string[] = [];
  return {
    warnings,
    warn(message: string) {
      warnings.push(message);
    },
  };
}

describe("namespaceRlsSessionBinding", () => {
  it("binds the ctx principalId UUID to the RLS principal setting", () => {
    const binding = namespaceRlsSessionBinding({ warn: () => undefined });

    expect(binding(context({ principalId: PRINCIPAL_ID, user: SUBJECT }))).toEqual(
      { [RLS_SETTINGS.Principal]: PRINCIPAL_ID }
    );
    expect(RLS_SETTINGS.Principal).toBe("app.principal_id");
  });

  it("trims the resolved principal id before binding it", () => {
    const binding = namespaceRlsSessionBinding({ warn: () => undefined });

    expect(
      binding(context({ principalId: `   ${PRINCIPAL_ID}   `, user: SUBJECT }))
    ).toEqual({ [RLS_SETTINGS.Principal]: PRINCIPAL_ID });
  });

  it("fails closed for an invalid, empty, non-string, or absent principal", () => {
    const { warnings, warn } = collectWarnings();
    const binding = namespaceRlsSessionBinding({ warn });

    expect(binding(undefined)).toBeUndefined();
    expect(binding(context({ principalId: "not-a-uuid", user: SUBJECT }))).toBeUndefined();
    expect(binding(context({ principalId: "   ", user: SUBJECT }))).toBeUndefined();
    expect(binding(context({ principalId: 12345, user: SUBJECT }))).toBeUndefined();
    expect(binding(context({ principalId: null, user: SUBJECT }))).toBeUndefined();
    // One warning per authenticated-but-unresolved resolution, never a bind.
    expect(warnings).toHaveLength(4);
  });

  it("warns once for an authenticated-but-unresolved context without leaking the value", () => {
    const { warnings, warn } = collectWarnings();
    const binding = namespaceRlsSessionBinding({ warn });
    const candidate = "leaky-candidate-value-not-a-uuid";

    expect(binding(context({ principalId: candidate, user: SUBJECT }))).toBeUndefined();

    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain(RLS_SETTINGS.Principal);
    expect(warnings[0]).not.toContain(candidate);
    expect(warnings[0]).not.toContain(SUBJECT);
  });

  it("stays silent for an unauthenticated context", () => {
    const { warnings, warn } = collectWarnings();
    const binding = namespaceRlsSessionBinding({ warn });

    expect(binding(context({ principalId: "not-a-uuid" }))).toBeUndefined();
    expect(binding(context({ principalId: PRINCIPAL_ID }))).toEqual({
      [RLS_SETTINGS.Principal]: PRINCIPAL_ID,
    });
    expect(warnings).toHaveLength(0);
  });

  it("honors custom principal and authenticated context keys", () => {
    const { warnings, warn } = collectWarnings();
    const binding = namespaceRlsSessionBinding({
      principalContextKey: "scopePrincipal",
      authenticatedContextKey: "actor",
      warn,
    });

    expect(
      binding(context({ scopePrincipal: PRINCIPAL_ID, actor: SUBJECT }))
    ).toEqual({ [RLS_SETTINGS.Principal]: PRINCIPAL_ID });
    expect(warnings).toHaveLength(0);

    // The default key is no longer consulted, and the custom authenticated
    // key still triggers the fail-closed warning.
    expect(
      binding(context({ principalId: PRINCIPAL_ID, actor: SUBJECT }))
    ).toBeUndefined();
    expect(warnings).toHaveLength(1);
  });
});

describe("namespaceRlsTypeORMOptions", () => {
  it("returns the resolver as adapter sessionBinding options", () => {
    const options = namespaceRlsTypeORMOptions({ warn: () => undefined });

    expect(Object.keys(options)).toEqual(["sessionBinding"]);
    expect(typeof options.sessionBinding).toBe("function");
    expect(
      options.sessionBinding(context({ principalId: PRINCIPAL_ID, user: SUBJECT }))
    ).toEqual({ [RLS_SETTINGS.Principal]: PRINCIPAL_ID });
  });

  it("propagates custom context keys to the returned resolver", () => {
    const { warnings, warn } = collectWarnings();
    const options = namespaceRlsTypeORMOptions({
      principalContextKey: "scopePrincipal",
      authenticatedContextKey: "actor",
      warn,
    });

    expect(
      options.sessionBinding(
        context({ scopePrincipal: PRINCIPAL_ID, actor: SUBJECT })
      )
    ).toEqual({ [RLS_SETTINGS.Principal]: PRINCIPAL_ID });
    expect(warnings).toHaveLength(0);
  });
});

describe("RLS template principal setting", () => {
  it("emits app.principal_id from RLS_SETTINGS.Principal", () => {
    const helper = RLS_FUNCTION_STATEMENTS.find((statement) =>
      statement.includes("FUNCTION app_rls_principal_id()")
    );

    expect(helper).toBeDefined();
    expect(helper).toContain(
      `current_setting('${RLS_SETTINGS.Principal}', true)`
    );
    expect(RLS_SETTINGS.Principal).toBe("app.principal_id");
  });
});
