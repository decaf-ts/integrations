/**
 * @description Task engine integration tests against live DragonflyDB
 * @summary Exercises the task engine end to end on the Redis adapter: handler
 * registration, task submission, execution, persisted status/result and event
 * emission. The full flow depends on generated `TaskModel` primary keys, produced
 * through the adapter sequence path.
 */
import { describe, it, expect, beforeAll, afterAll, jest } from "@jest/globals";
import { Context, sleep } from "@decaf-ts/core";
import { Logging } from "@decaf-ts/logging";
import { Observer } from "@decaf-ts/core/interfaces";
import {
  CompositeTaskBuilder,
  TaskBuilder,
  TaskContext,
  TaskEngine,
  TaskEventBus,
  TaskEventModel,
  TaskEventType,
  TaskHandler,
  TaskHandlerRegistry,
  TaskModel,
  TaskService,
  TaskStatus,
  TaskStepSpecModel,
  TaskType,
  task,
} from "@decaf-ts/core/tasks";
import { TaskEngineConfig } from "@decaf-ts/core/tasks/types";
import { Repository, Repo } from "@decaf-ts/core";
import { RedisAdapter } from "../../src/redis";
import {
  cleanupRedisTestResources,
  setupRedisAdapter,
  RedisTestResources,
} from "../helpers/redis";

jest.setTimeout(120000);

const parseNumberInput = (input: unknown): number => {
  if (typeof input === "number") return input;
  if (typeof input === "object" && input !== null) {
    const value = (input as { value?: unknown }).value;
    if (typeof value === "number") return value;
  }
  throw new Error("invalid task input");
};

@task("redis-simple-task")
class RedisSimpleTask extends TaskHandler<number | { value: number }, number> {
  async run(value: number | { value: number }, ctx: TaskContext) {
    const parsed = parseNumberInput(value);
    await ctx.flush();
    return parsed * 3;
  }
}

describe("Redis task engine integration", () => {
  describe("in-memory engine building blocks", () => {
    it("builds an atomic task with defaults", () => {
      const built = new TaskBuilder()
        .setClassification("redis-simple-task")
        .setInput({ value: 6 })
        .build();
      expect(built).toBeInstanceOf(TaskModel);
      expect(built.atomicity).toBe(TaskType.ATOMIC);
      expect(built.status).toBe(TaskStatus.PENDING);
      expect(built.maxAttempts).toBeGreaterThanOrEqual(1);
    });

    it("builds a composite task with steps", () => {
      const built = new CompositeTaskBuilder()
        .setClassification("redis-composite-task")
        .setSteps([
          new TaskStepSpecModel({
            classification: "redis-simple-task",
            input: { value: 2 },
          }),
        ])
        .build();
      expect(built.atomicity).toBe(TaskType.COMPOSITE);
      expect(built.steps).toHaveLength(1);
    });

    it("registers @task handlers and resolves them by classification", () => {
      const registry = new TaskHandlerRegistry();
      const handler = registry.get("redis-simple-task");
      expect(handler).toBeDefined();
      expect(handler).toBeInstanceOf(RedisSimpleTask);
    });

    it("delivers events through the TaskEventBus", async () => {
      const bus = new TaskEventBus();
      const seen: TaskEventModel[] = [];
      const observer: Observer = {
        async refresh(evt: TaskEventModel) {
          if (evt) seen.push(evt);
        },
      };
      const unsubscribe = bus.observe(observer);
      const ctx = new Context().accumulate({ logger: Logging.get() } as any);
      bus.emit(
        new TaskEventModel({
          taskId: "task-1",
          uuid: `evt-${Date.now()}`,
          classification: TaskEventType.STATUS,
          payload: { status: TaskStatus.RUNNING },
        }),
        ctx
      );
      await sleep(10);
      unsubscribe();
      expect(seen).toHaveLength(1);
      expect(seen[0].classification).toBe(TaskEventType.STATUS);
    });
  });

  describe("engine persistence", () => {
    let resources: RedisTestResources;
    let adapter: RedisAdapter;
    let taskService: TaskService;
    let engine: TaskEngine<RedisAdapter>;
    let taskRepo: Repo<TaskModel>;

    beforeAll(async () => {
      resources = await setupRedisAdapter("task-engine", "redis-task-engine");
      adapter = resources.adapter;

      const config: TaskEngineConfig<RedisAdapter> = {
        adapter,
        bus: new TaskEventBus(),
        registry: new TaskHandlerRegistry(),
        workerId: "redis-integration-worker",
        concurrency: 1,
        leaseMs: 500,
        pollMsIdle: 1000,
        pollMsBusy: 200,
        logTailMax: 5000,
        streamBufferSize: 5,
        maxLoggingBuffer: 100,
        loggingBufferTruncation: 10,
        gracefulShutdownMsTimeout: 4000,
        maxConcurrentCompositeSteps: 2,
      };

      taskService = new TaskService();
      await taskService.boot(config);
      engine = taskService.client as TaskEngine<RedisAdapter>;
      await engine.start();
      taskRepo = Repository.forModel(TaskModel, adapter.alias);
    });

    afterAll(async () => {
      await taskService.shutdown();
      await cleanupRedisTestResources(resources);
    });

    it("executes a task and persists its status and output", async () => {
      const toSubmit = new TaskBuilder()
        .setClassification("redis-simple-task")
        .setInput({ value: 6 })
        .build();

      const { task, tracker } = await engine.push(toSubmit, true);
      const output = await tracker.resolve();
      expect(output).toBe(18);

      const persisted = await taskRepo.read(task.id);
      expect(persisted.status).toBe(TaskStatus.SUCCEEDED);
      expect(persisted.output).toBe(18);
    });
  });
});
