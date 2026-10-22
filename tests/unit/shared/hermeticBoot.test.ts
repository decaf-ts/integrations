/**
 * @module integrations/tests/unit/shared/hermeticBoot
 * @summary SAA-1335 (SAA-1330 scope 1) fail-closed coverage plus SAA-1339
 * (SAA-1330 scope 2) re-entrancy coverage for the Environment-hermetic node
 * boot helper. `bootWithoutEnvironment` must reject a missing or non-object
 * explicit configuration with a `ValidationError` before ever calling the
 * service's `boot(...)`, so a node boot can never silently fall back to
 * Environment-derived configuration. Its per-instance shadow must also survive
 * overlapping and nested same-instance calls and restore the original own
 * `configFromEnvironment` descriptor exactly once, only when the outermost call
 * completes.
 * @description Uses stub services whose `boot` is a jest spy; the fail-closed
 * cases assert the spy is never invoked, so a regression that booted before
 * validating the config is caught directly. The re-entrancy cases drive
 * overlapping/nested/throw paths against a stub with an own non-default
 * `configFromEnvironment` descriptor and assert both the live shadow and the
 * exact restored descriptor.
 */
import { describe, it, expect, jest } from "@jest/globals";
import { ValidationError } from "@decaf-ts/db-decorators";
import { bootWithoutEnvironment } from "../../../src/shared/http";

type StubService = { boot: jest.Mock };

type LooseBootHelper = (
  service: StubService,
  config?: unknown
) => Promise<unknown>;

const callBoot = bootWithoutEnvironment as unknown as LooseBootHelper;

function makeService(): { service: StubService; boot: jest.Mock } {
  const boot = jest.fn(async () => {
    throw new Error("boot() must not be invoked in a fail-closed case");
  });
  return { service: { boot }, boot };
}

describe("bootWithoutEnvironment fail-closed validation (SAA-1330 scope 1)", () => {
  it("rejects with a ValidationError when config is omitted", async () => {
    const { service, boot } = makeService();

    await expect(callBoot(service)).rejects.toBeInstanceOf(ValidationError);

    expect(boot).not.toHaveBeenCalled();
  });

  it("rejects with a ValidationError when config is undefined", async () => {
    const { service, boot } = makeService();

    await expect(callBoot(service, undefined)).rejects.toBeInstanceOf(
      ValidationError
    );

    expect(boot).not.toHaveBeenCalled();
  });

  it("rejects with a ValidationError when config is null", async () => {
    const { service, boot } = makeService();

    await expect(callBoot(service, null)).rejects.toBeInstanceOf(
      ValidationError
    );

    expect(boot).not.toHaveBeenCalled();
  });

  it.each([
    ["string", "config"],
    ["number", 42],
    ["boolean", true],
  ])(
    "rejects with a ValidationError when config is a %s primitive",
    async (_label, config) => {
      const { service, boot } = makeService();

      await expect(callBoot(service, config)).rejects.toBeInstanceOf(
        ValidationError
      );

      expect(boot).not.toHaveBeenCalled();
    }
  );

  it("boots a stub service once with the explicit config and resolves to the same instance", async () => {
    const boot = jest.fn(async () => undefined);
    const service: StubService = { boot };
    const config = { host: "explicit.example", port: 2525 };

    await expect(
      bootWithoutEnvironment(
        service as unknown as { boot(...args: unknown[]): Promise<unknown> },
        config
      )
    ).resolves.toBe(service);

    expect(boot).toHaveBeenCalledTimes(1);
    expect(boot).toHaveBeenCalledWith(config);
  });
});

const CONFIG_FROM_ENVIRONMENT = "configFromEnvironment";

const ORIGINAL_SLICE = { slice: "original-config-from-environment" };

function originalConfigFromEnvironment(): unknown {
  return ORIGINAL_SLICE;
}

type HookService = {
  boot: jest.Mock;
  configFromEnvironment: () => unknown;
};

type Deferred<T = void> = {
  promise: Promise<T>;
  resolve: (value: T | PromiseLike<T>) => void;
  reject: (reason?: unknown) => void;
};

function defer<T = void>(): Deferred<T> {
  let resolve!: Deferred<T>["resolve"];
  let reject!: Deferred<T>["reject"];
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function ownHookDescriptor(
  service: HookService
): PropertyDescriptor | undefined {
  return Object.getOwnPropertyDescriptor(service, CONFIG_FROM_ENVIRONMENT);
}

function expectShadowInstalled(service: HookService): void {
  expect(service.configFromEnvironment()).toBeUndefined();
  const descriptor = ownHookDescriptor(service);
  expect(descriptor).toBeDefined();
  expect(typeof descriptor?.value).toBe("function");
  expect(descriptor?.value).not.toBe(originalConfigFromEnvironment);
  expect((descriptor?.value as () => unknown)()).toBeUndefined();
}

function makeOwnHookService(boot: jest.Mock): {
  service: HookService;
  originalDescriptor: PropertyDescriptor;
} {
  const service = {
    boot,
    configFromEnvironment: originalConfigFromEnvironment,
  } as HookService;
  Object.defineProperty(service, CONFIG_FROM_ENVIRONMENT, {
    configurable: true,
    enumerable: false,
    writable: false,
    value: originalConfigFromEnvironment,
  });
  return {
    service,
    originalDescriptor: ownHookDescriptor(service) as PropertyDescriptor,
  };
}

function makePrototypeHookService(boot: jest.Mock): HookService {
  const prototype = { configFromEnvironment: originalConfigFromEnvironment };
  const service = Object.create(prototype) as HookService;
  service.boot = boot;
  return service;
}

describe("bootWithoutEnvironment re-entrancy guard (SAA-1330 scope 2)", () => {
  it("keeps the shadow across overlapping calls on one instance and restores the own descriptor exactly once", async () => {
    const pending: Deferred[] = [];
    const boot = jest.fn(() => {
      const deferred = defer();
      pending.push(deferred);
      return deferred.promise;
    });
    const { service, originalDescriptor } = makeOwnHookService(boot);
    const firstConfig = { call: "first" };
    const secondConfig = { call: "second" };

    const first = callBoot(service, firstConfig);
    const second = callBoot(service, secondConfig);

    expect(boot).toHaveBeenCalledTimes(2);
    expect(boot).toHaveBeenNthCalledWith(1, firstConfig);
    expect(boot).toHaveBeenNthCalledWith(2, secondConfig);
    expectShadowInstalled(service);

    pending[0].resolve();
    await first;

    expectShadowInstalled(service);

    pending[1].resolve();
    await second;

    expect(ownHookDescriptor(service)).toEqual(originalDescriptor);
    expect(service.configFromEnvironment()).toBe(ORIGINAL_SLICE);
  });

  it("counts a nested call from inside boot() and restores only after the outermost call returns", async () => {
    const outerConfig = { call: "outer" };
    const innerConfig = { call: "inner" };
    let nested: Promise<unknown> | undefined;
    let outerShadow: unknown;

    const boot = jest.fn(async (config: unknown) => {
      if (config === outerConfig) {
        expectShadowInstalled(service);
        outerShadow = ownHookDescriptor(service)?.value;
        nested = callBoot(service, innerConfig);
        expectShadowInstalled(service);
        await nested;
        expect(ownHookDescriptor(service)?.value).toBe(outerShadow);
        expectShadowInstalled(service);
      } else {
        expect(ownHookDescriptor(service)?.value).toBe(outerShadow);
        expectShadowInstalled(service);
      }
    });

    const made = makeOwnHookService(boot);
    const service = made.service;

    await callBoot(service, outerConfig);

    expect(boot).toHaveBeenCalledTimes(2);
    expect(ownHookDescriptor(service)).toEqual(made.originalDescriptor);
    expect(service.configFromEnvironment()).toBe(ORIGINAL_SLICE);
  });

  it("restores the own descriptor after boot() rejects and does not leak WeakMap state into a later call", async () => {
    const failure = new Error("boot() failed");
    const boot = jest.fn(async () => {
      throw failure;
    });
    const { service, originalDescriptor } = makeOwnHookService(boot);

    await expect(callBoot(service, { call: "throwing" })).rejects.toBe(
      failure
    );

    expect(ownHookDescriptor(service)).toEqual(originalDescriptor);
    expect(service.configFromEnvironment()).toBe(ORIGINAL_SLICE);

    let sliceDuringSecondBoot: unknown = "not-observed";
    boot.mockImplementation(async () => {
      sliceDuringSecondBoot = service.configFromEnvironment();
    });

    await expect(callBoot(service, { call: "fresh" })).resolves.toBe(service);

    expect(sliceDuringSecondBoot).toBeUndefined();
    expect(ownHookDescriptor(service)).toEqual(originalDescriptor);
    expect(service.configFromEnvironment()).toBe(ORIGINAL_SLICE);
  });

  it("removes the own shadow after the outermost call when the hook is prototype-only", async () => {
    const boot = jest.fn(async () => {
      expect(Object.hasOwn(service, CONFIG_FROM_ENVIRONMENT)).toBe(true);
      expectShadowInstalled(service);
    });

    const service = makePrototypeHookService(boot);

    expect(Object.hasOwn(service, CONFIG_FROM_ENVIRONMENT)).toBe(false);
    expect(service.configFromEnvironment()).toBe(ORIGINAL_SLICE);

    await callBoot(service, { call: "prototype" });

    expect(Object.hasOwn(service, CONFIG_FROM_ENVIRONMENT)).toBe(false);
    expect(ownHookDescriptor(service)).toBeUndefined();
    expect(service.configFromEnvironment()).toBe(ORIGINAL_SLICE);
  });
});
