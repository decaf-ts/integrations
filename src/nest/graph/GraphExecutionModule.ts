/**
 * @module integrations/nest/graph/GraphExecutionModule
 * @summary NestJS DynamicModule hosting the graph execution engine.
 * @description Wires the {@link GraphExecutionEngine}, a demo executor registry, a RamAdapter-backed result repository, and the {@link GraphExecutionController} into a single NestJS module. Use `GraphExecutionModule.forRoot()` to register it in the application.
 */
import { DynamicModule, Module, Provider } from "@nestjs/common";
import { Adapter, Repository } from "@decaf-ts/core";
import { RamAdapter, RamFlavour } from "@decaf-ts/core/ram";

import { GraphExecutionEngine } from "../../graph";
import { createGraphExecutorRegistry } from "./GraphExecutorRegistryFactory";
import { GraphExecutionResultModel } from "./GraphExecutionResultModel";
import {
  GRAPH_RESULT_REPOSITORY,
  GraphExecutionController,
} from "./GraphExecutionController";

/**
 * Options for {@link GraphExecutionModule.forRoot}.
 */
export interface GraphExecutionModuleOptions {
  /**
   * User identifier passed to the RamAdapter. Defaults to `"graph-engine"`.
   */
  adapterUser?: string;
  /**
   * When `true`, calls `RamAdapter.decoration()` and
   * `Adapter.setCurrent(RamFlavour)` during module initialisation. Defaults to
   * `true`. Set to `false` when the host application has already configured a
   * RamAdapter.
   */
  initAdapter?: boolean;
}

/**
 * NestJS module that hosts the graph execution engine server-side.
 *
 * Provides:
 * - {@link GraphExecutionEngine} — singleton engine with a demo executor registry.
 * - `GRAPH_RESULT_REPOSITORY` — Decaf repository for {@link GraphExecutionResultModel} backed by RamAdapter.
 * - {@link GraphExecutionController} — REST + SSE controller.
 */
@Module({})
export class GraphExecutionModule {
  /**
   * Creates a configured {@link DynamicModule} for the graph execution backend.
   *
   * @param options - Module configuration options.
   * @returns A NestJS `DynamicModule` ready for import.
   */
  static forRoot(
    options: GraphExecutionModuleOptions = {}
  ): DynamicModule {
    const user = options.adapterUser ?? "graph-engine";
    const initAdapter = options.initAdapter ?? true;

    const providers: Provider[] = [
      {
        provide: GraphExecutionEngine,
        useFactory: () => {
          if (initAdapter) {
            RamAdapter.decoration();
            Adapter.setCurrent(RamFlavour);
          }
          const registry = createGraphExecutorRegistry();
          return new GraphExecutionEngine({ registry });
        },
      },
      {
        provide: GRAPH_RESULT_REPOSITORY,
        useFactory: () => {
          if (initAdapter) {
            RamAdapter.decoration();
            Adapter.setCurrent(RamFlavour);
          }
          // Creating the adapter ensures a Ram-flavoured instance is available
          // for Repository.forModel. The adapter user is used by audit handlers.
          new RamAdapter({ user });
          return Repository.forModel(GraphExecutionResultModel);
        },
      },
    ];

    return {
      module: GraphExecutionModule,
      controllers: [GraphExecutionController],
      providers,
      exports: [GraphExecutionEngine, GRAPH_RESULT_REPOSITORY],
    };
  }
}
