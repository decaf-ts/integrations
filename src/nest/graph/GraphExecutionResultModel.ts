/**
 * @module integrations/nest/graph/GraphExecutionResultModel
 * @summary Decaf model for persisting graph execution results.
 * @description Serializes a {@link GraphExecutionResult} for storage in a Decaf persistence adapter (e.g. RamAdapter). Stores the run id, workflow id, status, inputs, outputs, per-node results, and timing information so clients can retrieve a completed run's full state via `GET /graph/results/:runId`.
 */
import { Model, model, type ModelArg } from "@decaf-ts/decorator-validation";
import { column, pk, table } from "@decaf-ts/core";
import { uses } from "@decaf-ts/decoration";

/**
 * Ram flavour identifier. Duplicated here to avoid the side-effect import of
 * `@decaf-ts/core/ram` (which calls `RamAdapter.decoration()` at module load
 * time and can interfere with other modules' metadata initialisation).
 */
const RAM_FLAVOUR = "ram";

/**
 * Persisted representation of a completed graph execution run.
 *
 * Stored in the `graph_execution_result` table and keyed by `runId`.
 */
@uses(RAM_FLAVOUR)
@table("graph_execution_result")
@model()
export class GraphExecutionResultModel extends Model {
  /**
   * Unique identifier for this execution run. Acts as the primary key.
   */
  @pk({ type: String, generated: false })
  runId!: string;

  /**
   * Identifier of the workflow that was executed.
   */
  @column()
  workflowId!: string;

  /**
   * Final status of the run (e.g. `succeeded`, `failed`).
   */
  @column()
  status!: string;

  /**
   * Inputs supplied to the workflow at execution time.
   */
  @column()
  inputs!: Record<string, unknown>;

  /**
   * Outputs produced by the workflow.
   */
  @column()
  outputs!: Record<string, unknown>;

  /**
   * Per-node execution results keyed by node id.
   */
  @column()
  nodeResults!: Record<string, unknown>;

  /**
   * Timestamp marking when the run started.
   */
  @column()
  startedAt!: Date;

  /**
   * Timestamp marking when the run finished.
   */
  @column()
  finishedAt?: Date;

  constructor(arg?: ModelArg<GraphExecutionResultModel>) {
    super(arg);
  }
}
