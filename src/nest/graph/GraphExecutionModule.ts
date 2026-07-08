import { DynamicModule, Module, Provider } from "@nestjs/common";

import { GraphExecutionEngine } from "../../graph";
import { createDemoEngineConfig } from "./GraphExecutorRegistryFactory";
import { GraphExecutionController } from "./GraphExecutionController";
import { GraphResultService } from "./GraphResultService";
import { GraphWorkflowService } from "./GraphWorkflowService";

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
}

@Module({})
export class GraphExecutionModule {
  static forRoot(
    options: GraphExecutionModuleOptions = {}
  ): DynamicModule {
    const initAdapter = options.initAdapter ?? true;
    const adapterUser = options.adapterUser ?? "graph-engine";

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
          const config = createDemoEngineConfig();
          const engine = new GraphExecutionEngine(config);
          config.onEngineCreated(engine);
          return engine;
        },
      },
      GraphResultService,
      GraphWorkflowService,
    ];

    return {
      module: GraphExecutionModule,
      controllers: [GraphExecutionController],
      providers,
      exports: [GraphExecutionEngine, GraphResultService, GraphWorkflowService],
    };
  }
}
