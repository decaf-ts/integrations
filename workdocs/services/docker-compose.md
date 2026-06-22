# Docker Compose Service

[`DockerComposeService`](../../src/docker/DockerComposeService.ts) provides a small Decaf service wrapper for local container orchestration with Docker Compose.

## When To Use It

Use it when you want a service object that can:

- validate a compose file before startup
- run `docker compose up`, `down`, `restart`, and `exec`
- poll a health endpoint until the containerized stack is ready
- fetch container logs and runtime status

## Typical Flow

1. Create the service.
2. Call `initialize({ composeFile, workingDir? })`.
3. Use `up()`, `waitForHealth()`, and other helpers as needed.

```ts
import { DockerComposeService } from "@decaf-ts/integrations/docker";

const service = new DockerComposeService();
await service.initialize({
  composeFile: "./docker-compose.yml",
  workingDir: ".",
});

await service.up(true);
await service.waitForHealth("http://localhost:8080/health");
```

## Operations

- `up(detached?)`: start the compose stack.
- `down()`: stop the stack and remove volumes.
- `restart()`: restart the stack.
- `waitForHealth(url, options?)`: poll a URL until it responds with a success status.
- `execInContainer(containerName, command)`: run a command inside a container.
- `getLogs(containerName?, tail?)`: retrieve logs.
- `isRunning(containerName)`: check the container status.

## Notes

- The service validates that the compose file exists during initialization.
- Health checks are intentionally simple: they rely on the HTTP response status only.
- All operations run through the Decaf contextual logging flow.
