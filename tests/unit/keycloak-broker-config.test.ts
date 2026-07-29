import { describe, expect, it } from "@jest/globals";
import {
  buildBrokerIdentityProviderPayload,
} from "../../src/keycloak/services/KeycloakIdentityProviderService";
import {
  getBrokerExternalIdentityKey,
  isLocalKeycloakIssuer,
} from "../../src/keycloak/broker";

describe("DECAF-43 broker contracts", () => {
  it("builds a discovery-based OIDC broker without changing the legacy config", () => {
    expect(
      buildBrokerIdentityProviderPayload({
        alias: "external-keycloak",
        displayName: "External Keycloak",
        protocol: "oidc",
        upstreamIssuer: "http://external-keycloak:8080/realms/upstream",
        discoveryUrl:
          "http://external-keycloak:8080/realms/upstream/.well-known/openid-configuration",
        clientId: "broker-client",
        clientSecret: "secret",
        clientAuthMethod: "client_secret_basic",
      })
    ).toEqual(
      expect.objectContaining({
        providerId: "oidc",
        config: expect.objectContaining({
          issuer: "http://external-keycloak:8080/realms/upstream",
          metadataDescriptorUrl:
            "http://external-keycloak:8080/realms/upstream/.well-known/openid-configuration",
          clientAuthMethod: "client_secret_basic",
        }),
      })
    );
  });

  it("builds a SAML broker with protocol-specific settings", () => {
    const payload = buildBrokerIdentityProviderPayload({
      alias: "external-saml",
      displayName: "External SAML",
      protocol: "saml",
      saml: {
        entityId: "https://external.example/saml",
        singleSignOnServiceUrl: "https://external.example/saml/sso",
        postBindingResponse: false,
      },
    });

    expect(payload.providerId).toBe("saml");
    expect(payload.config).toEqual(
      expect.objectContaining({
        entityId: "https://external.example/saml",
        singleSignOnServiceUrl: "https://external.example/saml/sso",
        postBindingResponse: "false",
      })
    );
  });

  it("builds a private-key JWT OIDC broker payload", () => {
    const payload = buildBrokerIdentityProviderPayload({
      alias: "external-private-jwt",
      displayName: "External Keycloak JWT",
      protocol: "oidc",
      upstreamIssuer: "https://external.example/realms/partners",
      clientId: "broker-client",
      clientAuthMethod: "private_key_jwt",
      clientAssertionSigningAlg: "RS256",
      clientAssertionAudience: "https://external.example/token",
    });

    expect(payload.config).toEqual(
      expect.objectContaining({
        clientAuthMethod: "private_key_jwt",
        clientAssertionSigningAlg: "RS256",
        clientAssertionAudience: "https://external.example/token",
      })
    );
  });

  it("preserves client-secret JWT authentication in the broker payload", () => {
    const payload = buildBrokerIdentityProviderPayload({
      alias: "external-client-secret-jwt",
      displayName: "External Keycloak Client Secret JWT",
      protocol: "oidc",
      upstreamIssuer: "https://external.example/realms/partners",
      clientId: "broker-client",
      clientSecret: "secret",
      clientAuthMethod: "client_secret_jwt",
      clientAssertionSigningAlg: "HS256",
    });

    expect(payload.config).toEqual(
      expect.objectContaining({
        clientAuthMethod: "client_secret_jwt",
        clientAssertionSigningAlg: "HS256",
      })
    );
  });

  it("uses issuer and subject as the stable broker identity", () => {
    const first = getBrokerExternalIdentityKey("issuer-a", "subject-a");
    expect(first).toHaveLength(64);
    expect(getBrokerExternalIdentityKey("issuer-a", "subject-a")).toBe(first);
    expect(getBrokerExternalIdentityKey("issuer-b", "subject-a")).not.toBe(first);
    expect(getBrokerExternalIdentityKey("issuer-a", "subject-b")).not.toBe(first);
  });

  it("compares local issuers without treating a trailing slash as different", () => {
    expect(isLocalKeycloakIssuer("https://local/realms/app/", "https://local/realms/app")).toBe(true);
    expect(isLocalKeycloakIssuer("https://external/realms/app", "https://local/realms/app")).toBe(false);
  });
});
