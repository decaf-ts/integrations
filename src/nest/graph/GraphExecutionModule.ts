import { DynamicModule, Module, Provider } from "@nestjs/common";

import {
  GraphExecutionEngine,
  GraphNodeCatalogue,
  GraphRunService,
  InMemoryGraphRunEventStore,
  type GraphCredentialAuthorizer,
  type GraphRunLimits,
} from "../../graph";
import { createDemoEngineConfig } from "./GraphExecutorRegistryFactory";
import { GraphExecutionController, GRAPH_EXECUTION_OPTIONS, type GraphExecutionControllerOptions } from "./GraphExecutionController";
import {
  GraphNodeCatalogueController,
  GRAPH_CATALOGUE_CONTROLLER_OPTIONS,
  type GraphCatalogueControllerOptions,
} from "./GraphNodeCatalogueController";
import { GraphResultService } from "./GraphResultService";
import { GraphRunModelService } from "./GraphRunModelService";
import {
  GraphRunController,
  GRAPH_RUN_OPTIONS,
  type GraphRunControllerOptions,
} from "./GraphRunController";
import {
  GraphWorkflowService,
  GRAPH_WORKFLOW_OPTIONS,
  type GraphWorkflowServiceOptions,
} from "./GraphWorkflowService";
import {
  GraphWorkflowController,
  type GraphWorkflowControllerOptions,
} from "./GraphWorkflowController";

/**
 * Options for {@link GraphExecutionModule.forRoot}: adapter bootstrapping
 * plus per-API (catalogue, workflows, runs) authentication and limit
 * configuration.
 */
export interface GraphExecutionModuleOptions {
  /**
   * When `true`, the module bootstraps a default RamAdapter for standalone
   * development. When `false`, the host application is expected to have
   * already configured a Decaf adapter via `DecafModule.forRoot(...)`.
   * Defaults to `true` for backwards compatibility.
   */
  initAdapter?: boolean;
  /**
   * Adapter user identifier passed to `RamAdapter` when `initAdapter` is
   * `true`. Ignored when `initAdapter` is `false`.
   * Defaults to `"graph-engine"`.
   */
  adapterUser?: string;
  /**
   * Options for the node catalogue HTTP API (DECAF-50 §4.13): authentication
   * enforcement and backend-enforced rate limits for the expensive
   * `resolve`/`methods` operations.
   */
  catalogue?: GraphCatalogueControllerOptions;
  /**
   * Options for the canonical workflow persistence HTTP API (DECAF-50 §4.10):
   * authentication enforcement and backend-enforced document resource limits.
   */
  workflows?: GraphWorkflowControllerOptions & GraphWorkflowServiceOptions;
  /**
   * Options for the asynchronous run lifecycle API (DECAF-50 §4.14–§4.15):
   * authentication enforcement and backend-enforced run resource limits.
   */
  runs?: GraphRunControllerOptions;
  /**
   * Options for the legacy synchronous execution surface (SAA-595): the
   * deprecated global SSE stream is disabled unless explicitly enabled.
   */
  execution?: GraphExecutionControllerOptions;
  /**
   * Production hosts MUST wire a {@link GraphCredentialAuthorizer} backed by
   * their credential store (DECAF-50 §4.8 stage 8). Without it, stage-8
   * credential checks are shape/type-only: a reference that is
   * well-formed and type-matched is accepted without verifying that the
   * credential exists or that the run is authorized to use it (SAA-595 F8).
   */
  credentialAuthorizer?: GraphCredentialAuthorizer;
}

/**
 * NestJS module wiring the graph execution stack (DECAF-50 §4.13–§4.16): the
 * engine, catalogue, workflow persistence, run lifecycle/SSE controllers,
 * and their services. Configure via {@link GraphExecutionModule.forRoot}.
 */
@Module({})
export class GraphExecutionModule {
  /**
   * Creates the dynamic module. Boots a default RamAdapter for standalone
   * development unless `initAdapter` is `false`. Wires the optional
   * {@link GraphCredentialAuthorizer} into the engine's stage-8 validator
   * (SAA-595 F8), and applies the workflow options to the
   * {@link GraphWorkflowService} singleton via its {@link
   * GraphWorkflowService.configure} method, since `@service` constructor
   * injection does not forward provider options reliably.
   */
  static forRoot(
    options: GraphExecutionModuleOptions = {}
  ): DynamicModule {
    const initAdapter = options.initAdapter ?? true;
    const adapterUser = options.adapterUser ?? "graph-engine";

    let engineConfig: ReturnType<typeof createDemoEngineConfig> | undefined;
    const sharedConfig = () => (engineConfig ??= createDemoEngineConfig());

    const providers: Provider[] = [
      {
        provide: GraphExecutionEngine,
        useFactory: async () => {
          if (initAdapter) {
            const { RamAdapter, RamFlavour } = await import("@decaf-ts/core/ram");
            const { Adapter } = await import("@decaf-ts/core");
            RamAdapter.decoration();
            Adapter.setCurrent(RamFlavour);
            new RamAdapter({ user: adapterUser });
          }
          const config = sharedConfig();
          return new GraphExecutionEngine(
            options.credentialAuthorizer
              ? { ...config, credentialAuthorizer: options.credentialAuthorizer }
              : config
          );
        },
      },
      {
        provide: GraphNodeCatalogue,
        useFactory: () => sharedConfig().catalogue,
      },
      {
        provide: GRAPH_CATALOGUE_CONTROLLER_OPTIONS,
        useValue: options.catalogue ?? {},
      },
      {
        provide: GRAPH_WORKFLOW_OPTIONS,
        useValue: (options.workflows ?? {}) as GraphWorkflowServiceOptions &
          GraphWorkflowControllerOptions,
      },
      {
        provide: GRAPH_RUN_OPTIONS,
        useValue: (options.runs ?? {}) as GraphRunControllerOptions,
      },
      {
        provide: GRAPH_EXECUTION_OPTIONS,
        useValue: (options.execution ?? {}) as GraphExecutionControllerOptions,
      },
      {
        provide: InMemoryGraphRunEventStore,
        useFactory: () =>
          new InMemoryGraphRunEventStore(options.runs?.limits ?? {}),
      },
      GraphResultService,
      GraphRunModelService,
      {
        provide: GraphWorkflowService,
        useFactory: (
          workflowOptions: GraphWorkflowServiceOptions &
            GraphWorkflowControllerOptions
        ) => new GraphWorkflowService().configure(workflowOptions),
        inject: [GRAPH_WORKFLOW_OPTIONS],
      },
      {
        provide: GraphRunService,
        useFactory: (
          engine: GraphExecutionEngine,
          runStore: GraphRunModelService,
          eventStore: InMemoryGraphRunEventStore,
          workflowService: GraphWorkflowService
        ) =>
          new GraphRunService(engine, runStore, eventStore, {
            limits: (options.runs?.limits ?? {}) as GraphRunLimits,
            allowAnonymousAccess: options.runs?.allowAnonymousAccess === true,
            documentResolver: {
              resolve: async (workflowId, _ownerUser, ...args) =>
                workflowService.getDocument(workflowId, ...args),
            },
          }),
        inject: [
          GraphExecutionEngine,
          GraphRunModelService,
          InMemoryGraphRunEventStore,
          GraphWorkflowService,
        ],
      },
    ];

    return {
      module: GraphExecutionModule,
      controllers: [
        GraphExecutionController,
        GraphNodeCatalogueController,
        GraphWorkflowController,
        GraphRunController,
      ],
      providers,
      exports: [
        GraphExecutionEngine,
        GraphNodeCatalogue,
        GraphResultService,
        GraphRunModelService,
        GraphRunService,
        GraphWorkflowService,
      ],
    };
  }
}
