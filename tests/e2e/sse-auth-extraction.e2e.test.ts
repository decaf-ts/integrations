/**
 * @module integrations/e2e/sse-auth-extraction
 * @summary Live SSE fingerprint-extraction e2e over the Keycloak auth harness (DECAF-48).
 * @description Validates how the requester fingerprint for the for-nest SSE subscription
 * path is resolved (auth user -> x-correlation-id -> per-connection id) using the same
 * live authenticated Keycloak e2e harness as `keycloak-auth.e2e.test.ts`.
 *
 * Covers:
 *  (a) the authenticated user's token identity is the fingerprint and WINS over any
 *      conflicting `x-correlation-id` header,
 *  (b) without auth the same `x-correlation-id` on subscribe + SSE resolves to one
 *      fingerprint (filtered delivery),
 *  (c) no header and no auth -> per-connection fingerprint, private mode receives
 *      nothing unless subscribed,
 *  (d) a second SSE opened for the same authenticated user -> 409 ConflictError.
 */
import { jest, describe, beforeAll, afterAll, it, expect } from "@jest/globals";

import "../../src/nest";

import { Test } from "@nestjs/testing";
import { INestApplication } from "@nestjs/common";
import {
  DecafExceptionFilter,
  DecafModule,
  DecafAuthModule,
} from "@decaf-ts/for-nest";
import { RamTransformer } from "@decaf-ts/for-http/server";
// @ts-expect-error ram
import { RamAdapter, RamFlavour } from "@decaf-ts/core/ram";
import { Adapter, Repository } from "@decaf-ts/core";

import { KeycloakAuthHandler } from "../../src/nest";
import { FakePartner } from "./fakes/models/FakePartner";
import {
  TestJwtService,
  ADMIN_TOKEN,
  buildUserToken,
} from "./fakes/jwt";

RamAdapter.decoration();
Adapter.setCurrent(RamFlavour);

jest.setTimeout(180000);

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function delayUntil(predicate: () => boolean, timeoutMs: number): Promise<void> {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const tick = async () => {
      if (predicate()) return resolve();
      if (Date.now() - started > timeoutMs) {
        return reject(new Error(`Timed out after ${timeoutMs}ms`));
      }
      await sleep(50);
      tick();
    };
    void tick();
  });
}

type ParsedFrame = {
  event?: string;
  data: unknown;
};

/**
 * Minimal SSE client over global fetch. Captures the HTTP status (needed to assert
 * the 409 conflict) and parses `event:`/`data:` frames from the stream body.
 */
class SseClient {
  readonly frames: ParsedFrame[] = [];
  private readonly controller = new AbortController();
  private buffer = "";
  private readonly openPromise: Promise<Response>;

  constructor(
    url: string,
    headers: Record<string, string> = {}
  ) {
    this.openPromise = fetch(url, {
      headers: { Accept: "text/event-stream", ...headers },
      signal: this.controller.signal,
    }).then(async (response) => {
      if (response.ok && response.body) {
        void this.readLoop(response);
      }
      return response;
    });
  }

  async open(): Promise<Response> {
    return this.openPromise;
  }

  private async readLoop(response: Response): Promise<void> {
    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    for (;;) {
      let value: Uint8Array | undefined;
      let done: boolean;
      try {
        ({ done, value } = await reader.read());
      } catch {
        break;
      }
      if (done) break;
      this.buffer += decoder.decode(value, { stream: true });
      this.flushBuffer();
    }
  }

  private flushBuffer(): void {
    let boundary: number;
    while ((boundary = this.buffer.indexOf("\n\n")) !== -1) {
      const frame = this.buffer.slice(0, boundary);
      this.buffer = this.buffer.slice(boundary + 2);
      this.consumeFrame(frame);
    }
  }

  private consumeFrame(frame: string): void {
    let event = "message";
    let data = "";
    for (const line of frame.split("\n")) {
      if (line.startsWith("event:")) event = line.slice(6).trim();
      else if (line.startsWith("data:")) {
        data = line.length > 5 ? line.slice(5).trimStart() : data + "\n";
      }
    }
    if (!data) return;
    let parsed: unknown = data;
    try {
      parsed = JSON.parse(data);
    } catch {
      // keep raw string payload
    }
    this.frames.push({ event, data: parsed });
  }

  /** Resolves with the first `message` event whose payload satisfies the predicate. */
  async waitForMessage(
    predicate: (data: unknown) => boolean,
    timeoutMs = 20000,
    context = "SSE event"
  ): Promise<unknown> {
    await delayUntil(
      () => this.frames.some((f) => f.event !== "heartbeat" && predicate(f.data)),
      timeoutMs
    );
    const found = this.frames.find(
      (f) => f.event !== "heartbeat" && predicate(f.data)
    );
    if (!found) {
      throw new Error(`${context}: no matching message; frames=${JSON.stringify(this.frames)}`);
    }
    return found.data;
  }

  /** Asserts that no `message` event payload matching the predicate arrives. */
  async expectAbsent(
    predicate: (data: unknown) => boolean,
    windowMs = 1500
  ): Promise<void> {
    await sleep(windowMs);
    const hit = this.frames.find(
      (f) => f.event !== "heartbeat" && predicate(f.data)
    );
    expect(hit).toBeUndefined();
  }

  close(): void {
    this.controller.abort();
  }
}

const isCreateFor =
  (table: string, id: string) =>
  (data: unknown): boolean =>
    Array.isArray(data) &&
    data[0] === table &&
    data[1] === "create" &&
    data[2] === id;

describe("SSE fingerprint auth extraction (DECAF-48, Keycloak harness)", () => {
  let authApp: INestApplication;
  let publicApp: INestApplication;
  let authHost: string;
  let publicHost: string;
  let partnerRepo: any;
  const openSse = new Set<SseClient>();

  function track(client: SseClient): SseClient {
    openSse.add(client);
    return client;
  }

  async function closeAllSse(): Promise<void> {
    for (const client of openSse) {
      try {
        client.close();
      } catch {
        // ignore cleanup failures
      }
    }
    openSse.clear();
  }

  beforeAll(async () => {
    await new TestJwtService().boot({});

    // Authenticated harness — routes protected (fingerprint = auth user).
    authApp = await buildApp("/events", true);
    authHost = await listenHost(authApp);

    // Public-path harness — same Keycloak middleware, `/public` route escape hatch
    // so unauthenticated correlation-id / per-connection flows can be exercised.
    publicApp = await buildApp("/public/events", true);
    publicHost = await listenHost(publicApp);

    partnerRepo = Repository.forModel(FakePartner);
  });

  async function buildApp(
    apiPath: string,
    subscriptionMode: boolean
  ): Promise<INestApplication> {
    const moduleRef = await Test.createTestingModule({
      imports: [
        DecafAuthModule.forRoot({
          global: true,
          handler: KeycloakAuthHandler as any,
        }),
        await DecafModule.forRootAsync({
          conf: [[RamAdapter, { user: "root" }, new RamTransformer()]],
          autoControllers: false,
          observerOptions: {
            enableObserverEvents: true,
            subscriptionMode,
            observerApiPath: apiPath,
          },
        }),
      ],
    }).compile();
    const app = moduleRef.createNestApplication();
    app.useGlobalFilters(new DecafExceptionFilter());
    await app.init();
    return app;
  }

  async function listenHost(app: INestApplication): Promise<string> {
    const server = await app.listen(0, "127.0.0.1");
    const address = server.address();
    if (!address || typeof address === "string") {
      throw new Error("Failed to resolve server address");
    }
    return `127.0.0.1:${address.port}`;
  }

  afterEach(async () => {
    // One SSE connection per fingerprint: every test must release its claims so
    // the next test can claim the same authenticated identities again.
    await closeAllSse();
    await sleep(300);
  });

  afterAll(async () => {
    await closeAllSse();
    try {
      await authApp?.close();
    } catch {
      // ignore cleanup failures
    }
    try {
      await publicApp?.close();
    } catch {
      // ignore cleanup failures
    }
  });

  it("(a) the authenticated user identity wins over a conflicting x-correlation-id header", async () => {
    const sharedCorr = `shared-${Math.random().toString(36).slice(2)}`;
    const subscriberA = track(
      new SseClient(`http://${authHost}/events`, {
        Authorization: `Bearer ${ADMIN_TOKEN}`,
        "x-correlation-id": sharedCorr,
      })
    );
    expect((await subscriberA.open()).status).toBe(200);

    const res = await fetch(`http://${authHost}/events/subscribe`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${ADMIN_TOKEN}`,
        "Content-Type": "application/json",
        "x-correlation-id": sharedCorr,
      },
      body: JSON.stringify({ topics: ["FakePartner"] }),
    });
    expect(res.status).toBe(201);
    expect((await res.json()).topics).toEqual(["FakePartner"]);

    const recordId = `ft-${Math.random().toString(36).slice(2)}`;
    await partnerRepo.create(
      new FakePartner({ id: recordId, name: "from auth user" })
    );

    await subscriberA.waitForMessage(
      isCreateFor(FakePartner.name, recordId),
      20000,
      "authenticated subscriber (a)"
    );
  });

  it("(a.2) two authenticated users sharing one correlation id stay isolated", async () => {
    const sharedCorr = `shared-${Math.random().toString(36).slice(2)}`;
    const tokenUserB = buildSecondUserToken();

    const a = track(
      new SseClient(`http://${authHost}/events`, {
        Authorization: `Bearer ${ADMIN_TOKEN}`,
        "x-correlation-id": sharedCorr,
      })
    );
    const b = track(
      new SseClient(`http://${authHost}/events`, {
        Authorization: `Bearer ${tokenUserB}`,
        "x-correlation-id": sharedCorr,
      })
    );

    // If the conflicting correlation id won (a bug), the second SSE would 409:
    // auth identities must override the shared header, keeping the users isolated.
    expect((await a.open()).status).toBe(200);
    expect((await b.open()).status).toBe(200);

    // Only user A subscribes; fingerprints are the auth identities, so B's
    // connection claims under its own fingerprint and stays silent.
    const subscribe = await fetch(`http://${authHost}/events/subscribe`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${ADMIN_TOKEN}`,
        "Content-Type": "application/json",
        "x-correlation-id": sharedCorr,
      },
      body: JSON.stringify({ topics: ["FakePartner"] }),
    });
    expect(subscribe.status).toBe(201);
    expect(((await subscribe.json()) as { topics: string[] }).topics).toEqual([
      "FakePartner",
    ]);

    const idA = `ua-${Math.random().toString(36).slice(2)}`;
    const idB = `ub-${Math.random().toString(36).slice(2)}`;
    await partnerRepo.create(new FakePartner({ id: idA, name: "user A" }));
    await partnerRepo.create(new FakePartner({ id: idB, name: "user B" }));

    // Subscribed user A receives its own stream's events.
    await a.waitForMessage(isCreateFor(FakePartner.name, idA), 20000, "user A stream");

    // Unsubscribed user B receives no events even though the ids are FakePartner.
    await b.expectAbsent(isCreateFor(FakePartner.name, idB));
  });

  it("(b) without auth, the same x-correlation-id on subscribe + SSE unifies one fingerprint", async () => {
    const cid = `corr-${Math.random().toString(36).slice(2)}`;
    const res = await fetch(`http://${publicHost}/public/events/subscribe`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-correlation-id": cid },
      body: JSON.stringify({ topics: ["FakePartner"] }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { topics?: string[]; fingerprint?: string };
    expect(body.topics).toEqual(["FakePartner"]);
    expect(body.fingerprint).toBeDefined();

    const connected = track(
      new SseClient(`http://${publicHost}/public/events`, {
        "x-correlation-id": cid,
      })
    );
    expect((await connected.open()).status).toBe(200);
    const recordId = `cb-${Math.random().toString(36).slice(2)}`;
    await partnerRepo.create(new FakePartner({ id: recordId, name: "corr b" }));

    await connected.waitForMessage(
      isCreateFor(FakePartner.name, recordId),
      20000,
      "correlation-id subscriber (b)"
    );
  });

  it("(b.2) an unrelated correlation id gets no delivery in private mode", async () => {
    const otherCid = `other-${Math.random().toString(36).slice(2)}`;
    const ulistener = track(
      new SseClient(`http://${publicHost}/public/events`, {
        "x-correlation-id": otherCid,
      })
    );
    const recordId = `co-${Math.random().toString(36).slice(2)}`;
    await partnerRepo.create(new FakePartner({ id: recordId, name: "other corr" }));

    await ulistener.expectAbsent(isCreateFor(FakePartner.name, recordId));
  });

  it("(c) no header, no auth -> per-connection fingerprint; private mode receives nothing unless subscribed", async () => {
    const c1 = track(new SseClient(`http://${publicHost}/public/events`));
    const c2 = track(new SseClient(`http://${publicHost}/public/events`));

    // Distinct per-connection fingerprints both claim successfully (no 409).
    expect((await c1.open()).status).toBe(200);
    expect((await c2.open()).status).toBe(200);

    const recordId = `nc-${Math.random().toString(36).slice(2)}`;
    await partnerRepo.create(new FakePartner({ id: recordId, name: "no conn" }));

    await c1.expectAbsent(isCreateFor(FakePartner.name, recordId));
    await c2.expectAbsent(isCreateFor(FakePartner.name, recordId));
  });

  it("(d) a second SSE for the same authenticated user returns 409 ConflictError", async () => {
    const first = track(
      new SseClient(`http://${authHost}/events`, {
        Authorization: `Bearer ${ADMIN_TOKEN}`,
        "x-correlation-id": "d-owner",
      })
    );
    expect((await first.open()).status).toBe(200);

    const second = track(
      new SseClient(`http://${authHost}/events`, {
        Authorization: `Bearer ${ADMIN_TOKEN}`,
        "x-correlation-id": "d-owner",
      })
    );
    const secondResponse = await second.open();
    expect(secondResponse.status).toBe(409);
    expect((await secondResponse.json()) as any).toMatchObject({
      status: 409,
    });

    // Closing the first stream releases the claim so a reconnect works again.
    first.close();
    await sleep(500);
    const third = track(
      new SseClient(`http://${authHost}/events`, {
        Authorization: `Bearer ${ADMIN_TOKEN}`,
        "x-correlation-id": "d-owner",
      })
    );
    expect((await third.open()).status).toBe(200);
  });
});

function buildSecondUserToken(): string {
  // Counterparty authenticated user sharing the same correlation id as the admin.
  return buildUserToken({
    email: "second@example.com",
    preferred_username: "second",
    roles: ["admin"],
  });
}
