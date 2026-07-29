import { afterAll, beforeAll, describe, expect, it, jest } from "@jest/globals";
import { createServer, type Server } from "node:http";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, type Browser, type Page } from "playwright";
import { DockerComposeService } from "../../src/docker";
import { buildBrokerIdentityProviderPayload } from "../../src/keycloak/services/KeycloakIdentityProviderService";
import { isLocalKeycloakIssuer } from "../../src/keycloak/broker";

const MAIN_KEYCLOAK = process.env.DECAF_BROKER_MAIN_URL ?? "http://auth.localhost:8088";
const EXTERNAL_KEYCLOAK = process.env.DECAF_BROKER_EXTERNAL_URL ?? "http://external-auth.localhost:8088";
const PROTECTED = process.env.DECAF_BROKER_PROTECTED_URL ?? "http://protected.localhost:8088";
const BASE = `${MAIN_KEYCLOAK}/realms/base`;
const LOCAL = `${MAIN_KEYCLOAK}/realms/broker`;
const EXTERNAL = `${EXTERNAL_KEYCLOAK}/realms/external`;
const ADMIN_USER = process.env.KEYCLOAK_ADMIN_USER ?? "admin";
const ADMIN_PASSWORD = process.env.KEYCLOAK_ADMIN_PASSWORD ?? "admin";
const OIDC_CLIENT_SECRET = "broker-client-secret";
const TEST_PASSWORD = "ExternalUser123!";
const BASE_PASSWORD = "BaseUser123!";
const LOCAL_LINK_PASSWORD = "LocalLink123!";
const testDirname = path.dirname(fileURLToPath(import.meta.url));
const composeFile = path.resolve(testDirname, "../../docker/keycloak-broker-compose.yml");
const workingDir = path.dirname(composeFile);

jest.setTimeout(180000);

type Json = Record<string, any>;

async function jsonRequest(
  base: string,
  path: string,
  init: RequestInit = {},
  expected: number[] = [200]
): Promise<Json | Json[]> {
  const response = await fetch(`${base}${path}`, {
    ...init,
    headers: {
      ...(init.body ? { "content-type": "application/json" } : {}),
      ...init.headers,
    },
  });
  const body = await response.text();
  if (!expected.includes(response.status)) {
    throw new Error(`${init.method ?? "GET"} ${path} failed (${response.status}): ${body}`);
  }
  if (!body) return {};
  return JSON.parse(body) as Json;
}

async function adminToken(base: string): Promise<string> {
  const response = await fetch(
    `${base}/realms/master/protocol/openid-connect/token`,
    {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: "admin-cli",
        username: ADMIN_USER,
        password: ADMIN_PASSWORD,
        grant_type: "password",
      }),
    }
  );
  const body = (await response.json()) as Json;
  if (!response.ok || !body.access_token) {
    throw new Error(`Unable to obtain admin token from ${base}: ${JSON.stringify(body)}`);
  }
  return body.access_token as string;
}

async function adminRequest(
  base: string,
  token: string,
  method: string,
  path: string,
  payload?: Json,
  expected: number[] = [200]
): Promise<Json | Json[]> {
  return jsonRequest(
    base,
    path,
    {
      method,
      body: payload === undefined ? undefined : JSON.stringify(payload),
      headers: { authorization: `Bearer ${token}` },
    },
    expected
  );
}

async function waitForRealm(base: string): Promise<void> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      const response = await fetch(`${base}/realms/master`);
      if (response.ok) return;
      lastError = new Error(`Keycloak returned ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw lastError instanceof Error ? lastError : new Error("Keycloak did not become ready");
}

async function waitForProtectedAuth(): Promise<void> {
  let lastStatus = 0;
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      const response = await fetch(`${PROTECTED}/`, { redirect: "manual" });
      lastStatus = response.status;
      if ([302, 401, 403].includes(response.status)) return;
    } catch {
      // The auth proxy may still be restarting after its initial discovery attempt.
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error(`Protected auth route did not become ready (last status: ${lastStatus})`);
}

async function recreateRealm(base: string, token: string, realm: string): Promise<void> {
  await adminRequest(base, token, "DELETE", `/admin/realms/${realm}`, undefined, [204, 404]);
  await adminRequest(base, token, "POST", "/admin/realms", { realm, enabled: true, loginWithEmailAllowed: true }, [201]);
}

async function createClient(
  base: string,
  token: string,
  realm: string,
  payload: Json
): Promise<void> {
  await adminRequest(base, token, "POST", `/admin/realms/${realm}/clients`, payload, [201]);
}

async function createUser(
  base: string,
  token: string,
  realm: string,
  username: string,
  email: string
): Promise<void> {
  await adminRequest(
    base,
    token,
    "POST",
    `/admin/realms/${realm}/users`,
    {
      username,
      firstName: "Broker",
      lastName: "User",
      email,
      emailVerified: true,
      enabled: true,
      requiredActions: [],
      credentials: [{ type: "password", value: TEST_PASSWORD, temporary: false }],
    },
    [201]
  );
}

async function createLocalUser(
  base: string,
  token: string,
  realm: string,
  username: string,
  password: string
): Promise<void> {
  await adminRequest(
    base,
    token,
    "POST",
    `/admin/realms/${realm}/users`,
    {
      username,
      firstName: "Base",
      lastName: "User",
      email: "base@example.com",
      emailVerified: true,
      enabled: true,
      requiredActions: [],
      credentials: [{ type: "password", value: password, temporary: false }],
    },
    [201]
  );
}

async function externalToken(): Promise<Json> {
  return (await jsonRequest(
    EXTERNAL,
    "/protocol/openid-connect/token",
    {
      method: "POST",
      body: new URLSearchParams({
        client_id: "broker-oidc-client",
        client_secret: OIDC_CLIENT_SECRET,
        username: "broker-user",
        password: TEST_PASSWORD,
        grant_type: "password",
        scope: "openid profile email",
      }).toString(),
      headers: { "content-type": "application/x-www-form-urlencoded" },
    },
    [200]
  )) as Json;
}

function jwtPayload(token: string): Json {
  return JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString("utf8")) as Json;
}

async function loginAtKeycloak(
  page: Page,
  provider?: "External Keycloak OIDC" | "External Keycloak SAML",
  linkExisting = false,
  username = "broker-user",
  password = TEST_PASSWORD
): Promise<void> {
  if (provider && (await page.getByText(provider, { exact: true }).count())) {
    await page.getByText(provider, { exact: true }).click();
    await page.waitForLoadState("domcontentloaded");
  }
  await page.locator("#username").fill(username);
  await page.locator("#password").fill(password);
  await page.locator("#kc-login").click();
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (
      (await page.locator("#firstName").count()) ||
      (await page.locator("#linkAccount").count())
    )
      break;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  if (await page.locator("#firstName").count()) {
    await page.locator("#email").fill("broker@example.com");
    await page.locator("#firstName").fill("Broker");
    await page.locator("#lastName").fill("User");
    await page.locator("#kc-idp-review-profile-form input[type=submit]").click();
  }
  if (linkExisting && (await page.locator("#linkAccount").count())) {
    await page.locator("#linkAccount").click();
    await page.locator("#password").fill(LOCAL_LINK_PASSWORD);
    await page.locator("#kc-login").click();
  }
}

async function setLocalLinkPassword(token: string): Promise<void> {
  const users = (await adminRequest(
    MAIN_KEYCLOAK,
    token,
    "GET",
    "/admin/realms/broker/users?email=broker%40example.com"
  )) as Json[];
  if (!users[0]?.id) throw new Error("Brokered local user was not created");
  await adminRequest(
    MAIN_KEYCLOAK,
    token,
    "PUT",
    `/admin/realms/broker/users/${users[0].id}`,
    {
      ...users[0],
      credentials: [{ type: "password", value: LOCAL_LINK_PASSWORD, temporary: false }],
      requiredActions: [],
    },
    [204]
  );
}

function callbackServer(): {
  server: Server;
  port: Promise<number>;
  nextCallback: () => Promise<URL>;
} {
  const callbacks: URL[] = [];
  const waiters: Array<(url: URL) => void> = [];
  const nextCallback = () =>
    callbacks.length
      ? Promise.resolve(callbacks.shift()!)
      : new Promise<URL>((resolve) => waiters.push(resolve));
  const server = createServer((request, response) => {
    if (request.url?.startsWith("/callback?")) {
      const url = new URL(`http://127.0.0.1${request.url}`);
      const waiter = waiters.shift();
      if (waiter) waiter(url);
      else callbacks.push(url);
    }
    response.writeHead(200, { "content-type": "text/plain" });
    response.end("callback captured");
  });
  const port = new Promise<number>((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      resolve(typeof address === "object" && address ? address.port : 0);
    });
  });
  return { server, port, nextCallback };
}

describe("Keycloak realm brokering (live OIDC/SAML)", () => {
  let browser: Browser;
  let mainAdminToken: string;
  let externalAdminToken: string;
  let callback: ReturnType<typeof callbackServer>;
  let callbackRedirect: string;
  let dockerService: DockerComposeService | undefined;

  beforeAll(async () => {
    dockerService = new DockerComposeService();
    await dockerService.initialize({ composeFile, workingDir });
    await dockerService.up();
    await Promise.all([
      dockerService.waitForHealth(`${MAIN_KEYCLOAK}/realms/master`),
      dockerService.waitForHealth(`${EXTERNAL_KEYCLOAK}/realms/master`),
    ]);
    await waitForRealm(MAIN_KEYCLOAK);
    await waitForRealm(EXTERNAL_KEYCLOAK);
    mainAdminToken = await adminToken(MAIN_KEYCLOAK);
    externalAdminToken = await adminToken(EXTERNAL_KEYCLOAK);
    callback = callbackServer();
    callbackRedirect = `http://127.0.0.1:${await callback.port}/callback`;

    await recreateRealm(EXTERNAL_KEYCLOAK, externalAdminToken, "external");
    await recreateRealm(MAIN_KEYCLOAK, mainAdminToken, "base");
    await recreateRealm(MAIN_KEYCLOAK, mainAdminToken, "broker");

    await createLocalUser(MAIN_KEYCLOAK, mainAdminToken, "base", "base-user", BASE_PASSWORD);
    await createUser(EXTERNAL_KEYCLOAK, externalAdminToken, "external", "broker-user", "broker@example.com");
    await createClient(EXTERNAL_KEYCLOAK, externalAdminToken, "external", {
      clientId: "broker-oidc-client",
      protocol: "openid-connect",
      secret: OIDC_CLIENT_SECRET,
      publicClient: false,
      standardFlowEnabled: true,
      directAccessGrantsEnabled: true,
      redirectUris: [`${LOCAL}/broker/external-oidc/endpoint`],
      webOrigins: ["*"],
    });
    await createClient(EXTERNAL_KEYCLOAK, externalAdminToken, "external", {
      clientId: "broker-basic-client",
      protocol: "openid-connect",
      secret: "broker-basic-secret",
      publicClient: false,
      standardFlowEnabled: true,
      directAccessGrantsEnabled: false,
      redirectUris: [`${LOCAL}/broker/external-basic/endpoint`],
      webOrigins: ["*"],
    });
    await createClient(EXTERNAL_KEYCLOAK, externalAdminToken, "external", {
      clientId: "broker-private-jwt-client",
      protocol: "openid-connect",
      clientAuthenticatorType: "client-jwt",
      standardFlowEnabled: true,
      directAccessGrantsEnabled: false,
      redirectUris: [`${LOCAL}/broker/external-private-jwt/endpoint`],
      webOrigins: ["*"],
      attributes: {
        "jwks.url": "http://main-keycloak:8080/realms/broker/protocol/openid-connect/certs",
      },
    });
    await createClient(EXTERNAL_KEYCLOAK, externalAdminToken, "external", {
      clientId: "broker-client-secret-jwt-client",
      protocol: "openid-connect",
      secret: "broker-client-secret-jwt-secret",
      clientAuthenticatorType: "client-secret-jwt",
      standardFlowEnabled: true,
      directAccessGrantsEnabled: false,
      redirectUris: [`${LOCAL}/broker/external-client-secret-jwt/endpoint`],
      webOrigins: ["*"],
    });
    await createClient(EXTERNAL_KEYCLOAK, externalAdminToken, "external", {
      clientId: "external-saml-client",
      protocol: "saml",
      name: "External Keycloak SAML IdP",
      standardFlowEnabled: true,
      redirectUris: [`${LOCAL}/broker/external-saml/endpoint`],
      webOrigins: ["*"],
      attributes: {
        "saml.server.signature": "true",
        "saml.client.signature": "false",
        "saml.assertion.signature": "true",
        "saml.signature.algorithm": "RSA_SHA256",
      },
    });

    await createClient(MAIN_KEYCLOAK, mainAdminToken, "broker", {
      clientId: "protected-service",
      secret: "protected-service-secret",
      protocol: "openid-connect",
      publicClient: false,
      standardFlowEnabled: true,
      directAccessGrantsEnabled: false,
      redirectUris: [`${PROTECTED}/oauth2/callback`],
      webOrigins: ["*"],
    });
    await createClient(MAIN_KEYCLOAK, mainAdminToken, "base", {
      clientId: "base-e2e-client",
      secret: "base-e2e-client-secret",
      protocol: "openid-connect",
      publicClient: false,
      standardFlowEnabled: true,
      directAccessGrantsEnabled: false,
      redirectUris: [callbackRedirect],
      webOrigins: ["*"],
    });
    await createClient(MAIN_KEYCLOAK, mainAdminToken, "broker", {
      clientId: "broker-e2e-saml",
      secret: "broker-e2e-saml-secret",
      protocol: "openid-connect",
      publicClient: false,
      standardFlowEnabled: true,
      directAccessGrantsEnabled: false,
      redirectUris: [callbackRedirect],
      webOrigins: ["*"],
    });
    await createClient(MAIN_KEYCLOAK, mainAdminToken, "broker", {
      clientId: "broker-e2e-basic",
      secret: "broker-e2e-basic-secret",
      protocol: "openid-connect",
      publicClient: false,
      standardFlowEnabled: true,
      directAccessGrantsEnabled: false,
      redirectUris: [callbackRedirect],
      webOrigins: ["*"],
    });
    await createClient(MAIN_KEYCLOAK, mainAdminToken, "broker", {
      clientId: "broker-e2e-private-jwt",
      secret: "broker-e2e-private-jwt-secret",
      protocol: "openid-connect",
      publicClient: false,
      standardFlowEnabled: true,
      directAccessGrantsEnabled: false,
      redirectUris: [callbackRedirect],
      webOrigins: ["*"],
    });
    await createClient(MAIN_KEYCLOAK, mainAdminToken, "broker", {
      clientId: "broker-e2e-client-secret-jwt",
      secret: "broker-e2e-client-secret-jwt-secret",
      protocol: "openid-connect",
      publicClient: false,
      standardFlowEnabled: true,
      directAccessGrantsEnabled: false,
      redirectUris: [callbackRedirect],
      webOrigins: ["*"],
    });

    const oidcPayload = buildBrokerIdentityProviderPayload({
      alias: "external-oidc",
      displayName: "External Keycloak OIDC",
      protocol: "oidc",
      upstreamIssuer: EXTERNAL,
      discoveryUrl: `${EXTERNAL}/.well-known/openid-configuration`,
      clientId: "broker-oidc-client",
      clientSecret: OIDC_CLIENT_SECRET,
      clientAuthMethod: "client_secret_post",
      authenticateByDefault: true,
      trustEmail: true,
    });
    await adminRequest(MAIN_KEYCLOAK, mainAdminToken, "POST", "/admin/realms/broker/identity-provider/instances", oidcPayload, [201]);

    await adminRequest(
      MAIN_KEYCLOAK,
      mainAdminToken,
      "POST",
      "/admin/realms/broker/identity-provider/instances",
      buildBrokerIdentityProviderPayload({
        alias: "external-basic",
        displayName: "External Keycloak Basic Auth",
        protocol: "oidc",
        upstreamIssuer: EXTERNAL,
        clientId: "broker-basic-client",
        clientSecret: "broker-basic-secret",
        clientAuthMethod: "client_secret_basic",
        trustEmail: true,
      }),
      [201]
    );

    await adminRequest(
      MAIN_KEYCLOAK,
      mainAdminToken,
      "POST",
      "/admin/realms/broker/identity-provider/instances",
      buildBrokerIdentityProviderPayload({
        alias: "external-client-secret-jwt",
        displayName: "External Keycloak Client Secret JWT",
        protocol: "oidc",
        upstreamIssuer: EXTERNAL,
        clientId: "broker-client-secret-jwt-client",
        clientSecret: "broker-client-secret-jwt-secret",
        clientAuthMethod: "client_secret_jwt",
        clientAssertionSigningAlg: "HS256",
        clientAssertionAudience: `${EXTERNAL}/protocol/openid-connect/token`,
        trustEmail: true,
      }),
      [201]
    );

    await adminRequest(
      MAIN_KEYCLOAK,
      mainAdminToken,
      "POST",
      "/admin/realms/broker/identity-provider/instances",
      buildBrokerIdentityProviderPayload({
        alias: "external-private-jwt",
        displayName: "External Keycloak Private JWT",
        protocol: "oidc",
        upstreamIssuer: EXTERNAL,
        clientId: "broker-private-jwt-client",
        clientAuthMethod: "private_key_jwt",
        clientAssertionSigningAlg: "RS256",
        clientAssertionAudience: `${EXTERNAL}/protocol/openid-connect/token`,
        trustEmail: true,
      }),
      [201]
    );

    const samlPayload = buildBrokerIdentityProviderPayload({
      alias: "external-saml",
      displayName: "External Keycloak SAML",
      protocol: "saml",
      saml: {
        entityId: "external-saml-client",
        singleSignOnServiceUrl: `${EXTERNAL}/protocol/saml`,
        singleLogoutServiceUrl: `${EXTERNAL}/protocol/saml`,
        postBindingResponse: true,
        postBindingAuthnRequest: true,
      },
    });
    await adminRequest(MAIN_KEYCLOAK, mainAdminToken, "POST", "/admin/realms/broker/identity-provider/instances", samlPayload, [201]);
    await waitForProtectedAuth();

    browser = await chromium.launch({
      headless: true,
      args: [
        "--host-resolver-rules=MAP auth.localhost 127.0.0.1,MAP external-auth.localhost 127.0.0.1,MAP protected.localhost 127.0.0.1",
      ],
    });
  });

  afterAll(async () => {
    await browser?.close();
    callback?.server.close();
    await dockerService?.down();
  });

  it("completes OIDC brokering through Traefik and oauth2-proxy", async () => {
    const context = await browser.newContext();
    const page = await context.newPage();
    const protectedUrl = `${PROTECTED}/`;
    const response = await page.goto(
      `${PROTECTED}/oauth2/start?rd=${encodeURIComponent(protectedUrl)}`,
      { waitUntil: "domcontentloaded" }
    );
    await loginAtKeycloak(page, "External Keycloak OIDC");
    await page.waitForURL(protectedUrl, { timeout: 30000 });
    expect(response).toBeTruthy();
    expect(await page.locator("body").textContent()).toContain("Welcome to nginx");
    await context.close();
  });

  it("authenticates from a protected page and returns to the original request", async () => {
    const context = await browser.newContext();
    const page = await context.newPage();
    const requestedUrl = `${PROTECTED}/`;

    const initialResponse = await page.goto(requestedUrl, { waitUntil: "domcontentloaded" });
    expect(initialResponse?.status()).toBe(401);
    expect(await page.locator('input[name="rd"]').inputValue()).toBe(new URL(requestedUrl).pathname);
    expect(await page.getByText("Sign in with Keycloak OIDC", { exact: true }).count()).toBeGreaterThan(0);

    await page.getByText("Sign in with Keycloak OIDC", { exact: true }).click();
    await page.waitForLoadState("domcontentloaded");
    await loginAtKeycloak(page, "External Keycloak OIDC");
    await page.waitForURL(requestedUrl, { timeout: 30000 });

    expect(page.url()).toBe(requestedUrl);
    expect(await page.locator("body").textContent()).toContain("Welcome to nginx");
    await context.close();
  });

  it("completes direct login to a base local Keycloak realm", async () => {
    const context = await browser.newContext();
    const page = await context.newPage();
    const state = randomUUID();
    const authorize = new URL(`${BASE}/protocol/openid-connect/auth`);
    authorize.search = new URLSearchParams({
      client_id: "base-e2e-client",
      redirect_uri: callbackRedirect,
      response_type: "code",
      scope: "openid profile email",
      state,
    }).toString();
    await page.goto(authorize.toString(), { waitUntil: "domcontentloaded" });
    await loginAtKeycloak(page, undefined, false, "base-user", BASE_PASSWORD);
    const callbackUrl = await callback.nextCallback();
    expect(callbackUrl.searchParams.get("state")).toBe(state);
    const token = (await jsonRequest(
      BASE,
      "/protocol/openid-connect/token",
      {
        method: "POST",
        body: new URLSearchParams({
          client_id: "base-e2e-client",
          client_secret: "base-e2e-client-secret",
          redirect_uri: callbackRedirect,
          grant_type: "authorization_code",
          code: callbackUrl.searchParams.get("code")!,
        }).toString(),
        headers: { "content-type": "application/x-www-form-urlencoded" },
      },
      [200]
    )) as Json;
    expect(isLocalKeycloakIssuer(jwtPayload(token.access_token).iss, BASE)).toBe(true);
    await context.close();
  });

  it("creates a local user and issues a local token after OIDC brokering", async () => {
    const users = (await adminRequest(
      MAIN_KEYCLOAK,
      mainAdminToken,
      "GET",
      "/admin/realms/broker/users?username=broker-user"
    )) as Json[];
    expect(users).toHaveLength(1);
    expect(users[0].email).toBe("broker@example.com");

    const token = await externalToken();
    expect(isLocalKeycloakIssuer(jwtPayload(token.access_token).iss, LOCAL)).toBe(false);
  });

  it("rejects an external token at the protected service boundary", async () => {
    const token = await externalToken();
    const response = await fetch(`${PROTECTED}/`, {
      headers: { authorization: `Bearer ${token.access_token}` },
      redirect: "manual",
    });
    expect([302, 401, 403]).toContain(response.status);
  });

  it("completes manually configured OIDC brokering with client-secret-basic", async () => {
    await setLocalLinkPassword(mainAdminToken);
    const context = await browser.newContext();
    const page = await context.newPage();
    const state = randomUUID();
    const authorize = new URL(`${LOCAL}/protocol/openid-connect/auth`);
    authorize.search = new URLSearchParams({
      client_id: "broker-e2e-basic",
      redirect_uri: callbackRedirect,
      response_type: "code",
      scope: "openid profile email",
      state,
      kc_idp_hint: "external-basic",
    }).toString();
    await page.goto(authorize.toString(), { waitUntil: "domcontentloaded" });
    await loginAtKeycloak(page, undefined, true);
    const callbackUrl = await callback.nextCallback();
    expect(callbackUrl.searchParams.get("state")).toBe(state);
    const token = (await jsonRequest(
      LOCAL,
      "/protocol/openid-connect/token",
      {
        method: "POST",
        body: new URLSearchParams({
          client_id: "broker-e2e-basic",
          client_secret: "broker-e2e-basic-secret",
          redirect_uri: callbackRedirect,
          grant_type: "authorization_code",
          code: callbackUrl.searchParams.get("code")!,
        }).toString(),
        headers: { "content-type": "application/x-www-form-urlencoded" },
      },
      [200]
    )) as Json;
    expect(isLocalKeycloakIssuer(jwtPayload(token.access_token).iss, LOCAL)).toBe(true);
    await context.close();
  });

  it("completes a SAML broker flow and returns a local issuer token", async () => {
    await setLocalLinkPassword(mainAdminToken);
    const context = await browser.newContext();
    const page = await context.newPage();
    const state = randomUUID();
    const authorize = new URL(`${LOCAL}/protocol/openid-connect/auth`);
    authorize.search = new URLSearchParams({
      client_id: "broker-e2e-saml",
      redirect_uri: callbackRedirect,
      response_type: "code",
      scope: "openid profile email",
      state,
      kc_idp_hint: "external-saml",
    }).toString();
    await page.goto(authorize.toString(), { waitUntil: "domcontentloaded" });
    await loginAtKeycloak(page, "External Keycloak SAML", true);
    const callbackUrl = await callback.nextCallback();
    expect(callbackUrl.searchParams.get("state")).toBe(state);
    expect(callbackUrl.searchParams.get("code")).toBeTruthy();

    const token = (await jsonRequest(
      LOCAL,
      "/protocol/openid-connect/token",
      {
        method: "POST",
        body: new URLSearchParams({
          client_id: "broker-e2e-saml",
          client_secret: "broker-e2e-saml-secret",
          redirect_uri: callbackRedirect,
          grant_type: "authorization_code",
          code: callbackUrl.searchParams.get("code")!,
        }).toString(),
        headers: { "content-type": "application/x-www-form-urlencoded" },
      },
      [200]
    )) as Json;
    expect(isLocalKeycloakIssuer(jwtPayload(token.access_token).iss, LOCAL)).toBe(true);
    await context.close();
  });

  it("completes OIDC brokering with private-key JWT client authentication", async () => {
    await setLocalLinkPassword(mainAdminToken);
    const context = await browser.newContext();
    const page = await context.newPage();
    const state = randomUUID();
    const authorize = new URL(`${LOCAL}/protocol/openid-connect/auth`);
    authorize.search = new URLSearchParams({
      client_id: "broker-e2e-private-jwt",
      redirect_uri: callbackRedirect,
      response_type: "code",
      scope: "openid profile email",
      state,
      kc_idp_hint: "external-private-jwt",
    }).toString();
    await page.goto(authorize.toString(), { waitUntil: "domcontentloaded" });
    await loginAtKeycloak(page, undefined, true);
    const callbackUrl = await callback.nextCallback();
    expect(callbackUrl.searchParams.get("state")).toBe(state);
    const token = (await jsonRequest(
      LOCAL,
      "/protocol/openid-connect/token",
      {
        method: "POST",
        body: new URLSearchParams({
          client_id: "broker-e2e-private-jwt",
          client_secret: "broker-e2e-private-jwt-secret",
          redirect_uri: callbackRedirect,
          grant_type: "authorization_code",
          code: callbackUrl.searchParams.get("code")!,
        }).toString(),
        headers: { "content-type": "application/x-www-form-urlencoded" },
      },
      [200]
    )) as Json;
    expect(isLocalKeycloakIssuer(jwtPayload(token.access_token).iss, LOCAL)).toBe(true);
    await context.close();
  });

  it("completes OIDC brokering with client-secret JWT authentication", async () => {
    await setLocalLinkPassword(mainAdminToken);
    const context = await browser.newContext();
    const page = await context.newPage();
    const state = randomUUID();
    const authorize = new URL(`${LOCAL}/protocol/openid-connect/auth`);
    authorize.search = new URLSearchParams({
      client_id: "broker-e2e-client-secret-jwt",
      redirect_uri: callbackRedirect,
      response_type: "code",
      scope: "openid profile email",
      state,
      kc_idp_hint: "external-client-secret-jwt",
    }).toString();
    await page.goto(authorize.toString(), { waitUntil: "domcontentloaded" });
    await loginAtKeycloak(page, undefined, true);
    const callbackUrl = await callback.nextCallback();
    expect(callbackUrl.searchParams.get("state")).toBe(state);
    const token = (await jsonRequest(
      LOCAL,
      "/protocol/openid-connect/token",
      {
        method: "POST",
        body: new URLSearchParams({
          client_id: "broker-e2e-client-secret-jwt",
          client_secret: "broker-e2e-client-secret-jwt-secret",
          redirect_uri: callbackRedirect,
          grant_type: "authorization_code",
          code: callbackUrl.searchParams.get("code")!,
        }).toString(),
        headers: { "content-type": "application/x-www-form-urlencoded" },
      },
      [200]
    )) as Json;
    expect(isLocalKeycloakIssuer(jwtPayload(token.access_token).iss, LOCAL)).toBe(true);
    await context.close();
  });
});
