import { describe, it, expect, beforeAll, afterEach, afterAll, jest } from "@jest/globals";
import { defaultQueryAttr, OrderDirection, Repository } from "@decaf-ts/core";
import {
  TaskBackoffModel,
  TaskEventModel,
  TaskEventType,
  TaskModel,
  TaskStatus,
} from "@decaf-ts/core/tasks";
import { NotFoundError } from "@decaf-ts/db-decorators";
import { RedisAdapter } from "../../src/redis";
import {
  cleanupRedisTestResources,
  setupRedisAdapter,
  RedisTestResources,
} from "../helpers/redis";

jest.setTimeout(50000);

defaultQueryAttr()(TaskModel.prototype, "classification");
defaultQueryAttr()(TaskModel.prototype, "name");
defaultQueryAttr()(TaskEventModel.prototype, "taskId");
defaultQueryAttr()(TaskEventModel.prototype, "classification");

let seq = 0;

const buildTask = (overrides: Partial<TaskModel> = {}) => {
  seq += 1;
  const classification =
    overrides.classification ??
    `task-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const name =
    overrides.name ?? `task-name-${Math.random().toString(36).slice(2, 6)}`;
  const backoff = overrides.backoff ?? new TaskBackoffModel();
  return new TaskModel({
    // DEFECT SAA-2050: generated `@pk()` sequences route through a proxied,
    // unconnected client ("The client is closed"). Supplying the id explicitly
    // skips `pkOnCreate` (it returns early when `model[key]` is set), so the
    // non-sequence behaviour of the task models can still be exercised.
    id: overrides.id ?? `task-id-${seq}-${Math.random().toString(36).slice(2, 8)}`,
    classification,
    name,
    maxAttempts: overrides.maxAttempts ?? 3,
    backoff,
    input: overrides.input,
    ...overrides,
  });
};

describe("TaskModel and TaskEventModel repositories against DragonflyDB", () => {
  let resources: RedisTestResources;
  let adapter: RedisAdapter;
  let taskRepo: Repository<TaskModel, any>;
  let eventRepo: Repository<TaskEventModel, any>;

  beforeAll(async () => {
    resources = await setupRedisAdapter("task-models", "redis-task-models");
    adapter = resources.adapter;
    taskRepo = Repository.forModel(TaskModel, adapter.alias);
    eventRepo = Repository.forModel(TaskEventModel, adapter.alias);
  });

  afterEach(async () => {
    const existingTasks = await taskRepo.select().execute();
    if (existingTasks.length)
      await taskRepo.deleteAll(existingTasks.map((t) => t.id));
    const existingEvents = await eventRepo.select().execute();
    if (existingEvents.length)
      await eventRepo.deleteAll(existingEvents.map((evt) => evt.id));
  });

  afterAll(async () => {
    await cleanupRedisTestResources(resources);
  });

  it("performs task CRUD operations", async () => {
    const toCreate = buildTask({ classification: "crud-task" });
    const created = await taskRepo.create(toCreate);
    expect(created.id).toBeDefined();
    expect(created.status).toBe(TaskStatus.PENDING);

    const read = await taskRepo.read(created.id);
    expect(read.classification).toBe(created.classification);

    read.status = TaskStatus.SUCCEEDED;
    read.output = { value: 42 };
    read.name = "crud-task-updated";
    const updated = await taskRepo.update(read);
    expect(updated.status).toBe(TaskStatus.SUCCEEDED);
    expect(updated.output).toEqual({ value: 42 });

    await taskRepo.delete(updated.id);
    await expect(taskRepo.read(updated.id)).rejects.toThrow(NotFoundError);
  });

  it("supports bulk task operations", async () => {
    const models = Array.from({ length: 3 }, (_, index) =>
      buildTask({ classification: `bulk-task-${index + 1}` })
    );
    const created = await taskRepo.createAll(models);
    expect(created).toHaveLength(3);

    const read = await taskRepo.readAll(created.map((t) => t.id));
    expect(read).toHaveLength(3);

    const toUpdate = read.map((task, index) => {
      task.name = `updated-${index}`;
      task.status = TaskStatus.SUCCEEDED;
      return task;
    });
    const updated = await taskRepo.updateAll(toUpdate);
    expect(updated.every((t) => t.status === TaskStatus.SUCCEEDED)).toBe(true);

    const deleted = await taskRepo.deleteAll(updated.map((t) => t.id));
    expect(deleted).toHaveLength(3);
    await expect(taskRepo.read(created[0].id)).rejects.toThrow(NotFoundError);
  });

  it("exposes list/find/pagination helpers", async () => {
    const classifications = ["find-a", "find-b", "find-c"];
    await taskRepo.createAll(
      classifications.map((classification) => buildTask({ classification }))
    );

    const listed = await taskRepo.listBy("classification", OrderDirection.ASC);
    expect(listed.some((t) => classifications.includes(t.classification))).toBe(
      true
    );

    const found = await taskRepo.find("find", OrderDirection.ASC);
    expect(found.length).toBeGreaterThanOrEqual(3);
    expect(found.every((t) => t.classification?.startsWith("find"))).toBe(true);

    const pageResult = await taskRepo
      .select()
      .where(taskRepo.attr("classification").startsWith("find"))
      .orderBy(["classification", OrderDirection.ASC])
      .paginate(2);
    expect((await pageResult.page(1)).length).toBeLessThanOrEqual(2);

    const byClassification = await taskRepo.findBy("classification", "find-a");
    expect(byClassification[0].classification).toBe("find-a");

    const foundOne = await taskRepo.findOneBy("classification", "find-b");
    expect(foundOne.classification).toBe("find-b");
  });

  it("manages task events and query helpers", async () => {
    const task = await taskRepo.create(
      buildTask({ classification: "event-task" })
    );
    const eventsToCreate = [
      new TaskEventModel({
        taskId: task.id,
        uuid: `evt-1-${Date.now()}`,
        classification: TaskEventType.STATUS,
        payload: { status: TaskStatus.RUNNING },
      }),
      new TaskEventModel({
        taskId: task.id,
        uuid: `evt-2-${Date.now()}`,
        classification: TaskEventType.STATUS,
        payload: { status: TaskStatus.SCHEDULED },
      }),
      new TaskEventModel({
        taskId: task.id,
        uuid: `evt-3-${Date.now()}`,
        classification: TaskEventType.PROGRESS,
        payload: { detail: "halfway" },
      }),
    ];

    const createdEvents = await eventRepo.createAll(eventsToCreate);
    expect(createdEvents).toHaveLength(3);
    const primaryEvent = await eventRepo.read(createdEvents[0].id);
    expect((primaryEvent.payload as any)?.status).toBe(TaskStatus.RUNNING);

    const listByClassification = await eventRepo.listBy(
      "classification",
      OrderDirection.DSC
    );
    expect(listByClassification.length).toBeGreaterThanOrEqual(3);

    const paged = await eventRepo
      .select()
      .where(eventRepo.attr("taskId").eq(task.id))
      .orderBy(["classification", OrderDirection.DSC])
      .paginate(2);
    expect((await paged.page(1)).length).toBeGreaterThan(0);

    const byStatus = await eventRepo.findBy(
      "classification",
      TaskEventType.STATUS
    );
    expect(
      byStatus.every((evt) => evt.classification === TaskEventType.STATUS)
    ).toBe(true);

    const progressEvent = await eventRepo.findOneBy(
      "classification",
      TaskEventType.PROGRESS
    );
    expect(progressEvent?.classification).toBe(TaskEventType.PROGRESS);

    await eventRepo.delete(primaryEvent.id);
    await expect(eventRepo.read(primaryEvent.id)).rejects.toThrow(NotFoundError);
  });
});
