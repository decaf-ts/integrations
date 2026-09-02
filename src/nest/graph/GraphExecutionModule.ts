import { DynamicModule, Module, Provider } from "@nestjs/common";

import {
  GraphExecutionEngine,
  GraphNodeCatalogue,
  GraphRunService,
  InMemoryGraphRunEventStore,
  type GraphRunLimits,
} from "../../graph";
import { createDemoEngineConfig } from "./GraphExecutorRegistryFactory";
import { GraphExecutionController } from "./GraphExecutionController";
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
   * development unless `initAdapter` is `false`.
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
          return new GraphExecutionEngine(config);
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
        provide: InMemoryGraphRunEventStore,
        useFactory: () =>
          new InMemoryGraphRunEventStore(options.runs?.limits ?? {}),
      },
      GraphResultService,
      GraphRunModelService,
      GraphWorkflowService,
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
