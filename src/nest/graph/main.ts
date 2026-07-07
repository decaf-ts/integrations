/**
 * @module integrations/nest/graph/main
 * @summary Standalone NestJS bootstrap for the graph execution backend.
 * @description Starts a NestJS HTTP server hosting the
 * {@link GraphExecutionModule} on the given port (default 3000). Used by the
 * for-angular `start:graph-backend` script so the graph page has an SSE
 * backend to talk to during development.
 *
 * Usage: `node lib/nest/graph/main.js [port]`
 */
import { NestFactory } from "@nestjs/core";
import { GraphExecutionModule } from "./GraphExecutionModule";

async function bootstrap(): Promise<void> {
  const port = Number(process.env["GRAPH_BACKEND_PORT"] ?? process.argv[2] ?? 3000);

  const app = await NestFactory.create(GraphExecutionModule.forRoot());
  app.enableCors();
  await app.listen(port);

   
  console.log(`[graph-backend] NestJS graph execution server listening on http://localhost:${port}`);
   
  console.log(`[graph-backend]   POST   /graph/execute`);
   
  console.log(`[graph-backend]   GET    /graph/events (SSE)`);
   
  console.log(`[graph-backend]   GET    /graph/results/:runId`);
}

bootstrap().catch((err) => {
   
  console.error("[graph-backend] Failed to start:", err);
  process.exit(1);
});
