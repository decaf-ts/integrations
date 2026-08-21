/**
 * @module integrations/tests/e2e/stubs/nestjs-swagger
 * @summary Minimal test-only stand-in for `@nestjs/swagger`.
 * @description The environment's `@nestjs/swagger` install is source-only and has
 * no runnable entry (missing `dist/`). The for-nest layer imports swagger
 * decorators and helpers for OpenAPI surface that is never exercised by the live
 * runtime here, so tests map `@nestjs/swagger` to these no-op stand-ins and keep
 * the Keycloak e2e harness runnable. Production code is not affected — this stub
 * is only reachable through the jest `moduleNameMapper`.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Target = any;

/**
 * Builds a no-op decorator that leaves the decorated target untouched (returning
 * the class itself at class level, otherwise `undefined`).
 */
function noopDecorator(): (
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ...args: any[]
) => Target | undefined {
  return (_target: Target) => (_classOrTarget: Target) =>
    typeof _classOrTarget === "function" ? _classOrTarget : undefined;
}

/**
 * Placeholder value matcher: resolves the schema path for a given decorator/schema
 * target. Only used inside OpenAPI setup flows that are not part of the e2e path.
 */
export function getSchemaPath(schema: { name?: string }): string {
  return `#/components/schemas/${schema?.name ?? ""}`;
}

/** No-op stand-in for `@nestjs/swagger#ApiBearerAuth`. */
export function ApiBearerAuth(..._args: unknown[]): ReturnType<typeof noopDecorator> {
  return noopDecorator();
}

/** No-op stand-in for `@nestjs/swagger#ApiSecurity`. */
export function ApiSecurity(..._args: unknown[]): ReturnType<typeof noopDecorator> {
  return noopDecorator();
}

/** No-op stand-in for `@nestjs/swagger#ApiTags`. */
export function ApiTags(..._args: unknown[]): ReturnType<typeof noopDecorator> {
  return noopDecorator();
}

/** No-op stand-in for `@nestjs/swagger#ApiOperation`. */
export function ApiOperation(..._args: unknown[]): ReturnType<typeof noopDecorator> {
  return noopDecorator();
}

/** No-op stand-in for `@nestjs/swagger#ApiParam`. */
export function ApiParam(..._args: unknown[]): ReturnType<typeof noopDecorator> {
  return noopDecorator();
}

/** No-op stand-in for `@nestjs/swagger#ApiQuery`. */
export function ApiQuery(..._args: unknown[]): ReturnType<typeof noopDecorator> {
  return noopDecorator();
}

/** No-op stand-in for `@nestjs/swagger#ApiBody`. */
export function ApiBody(..._args: unknown[]): ReturnType<typeof noopDecorator> {
  return noopDecorator();
}

/** No-op stand-in for `@nestjs/swagger#ApiExtraModels`. */
export function ApiExtraModels(..._args: unknown[]): ReturnType<typeof noopDecorator> {
  return noopDecorator();
}

/** No-op stand-in for `@nestjs/swagger#ApiExcludeEndpoint`. */
export function ApiExcludeEndpoint(
  ..._args: unknown[]
): ReturnType<typeof noopDecorator> {
  return noopDecorator();
}

/** No-op stand-in for `@nestjs/swagger#ApiOkResponse`. */
export function ApiOkResponse(
  ..._args: unknown[]
): ReturnType<typeof noopDecorator> {
  return noopDecorator();
}

/** No-op stand-in for `@nestjs/swagger#ApiCreatedResponse`. */
export function ApiCreatedResponse(
  ..._args: unknown[]
): ReturnType<typeof noopDecorator> {
  return noopDecorator();
}

/** No-op stand-in for `@nestjs/swagger#ApiBadRequestResponse`. */
export function ApiBadRequestResponse(
  ..._args: unknown[]
): ReturnType<typeof noopDecorator> {
  return noopDecorator();
}

/** No-op stand-in for `@nestjs/swagger#ApiNotFoundResponse`. */
export function ApiNotFoundResponse(
  ..._args: unknown[]
): ReturnType<typeof noopDecorator> {
  return noopDecorator();
}

/** No-op stand-in for `@nestjs/swagger#ApiUnprocessableEntityResponse`. */
export function ApiUnprocessableEntityResponse(
  ..._args: unknown[]
): ReturnType<typeof noopDecorator> {
  return noopDecorator();
}

/** No-op stand-in for `@nestjs/swagger#ApiNoContentResponse`. */
export function ApiNoContentResponse(
  ..._args: unknown[]
): ReturnType<typeof noopDecorator> {
  return noopDecorator();
}

/** No-op stand-in for the `@nestjs/swagger` OpenAPI document builder. */
export class DocumentBuilder {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [method: string]: any;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  public setTitle = (_title: string): this => this;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  public setDescription = (_description: string): this => this;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  public setVersion = (_version: string): this => this;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  public addBearerAuth = (_options?: unknown): this => this;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  public addSecurity = (_name: string, _options?: unknown): this => this;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  public addTag = (_name: string, _description?: string): this => this;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  public addServer = (_url: string, _description?: string): this => this;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  public build = (): Record<string, never> => ({});
}

/** No-op stand-in for the `@nestjs/swagger` module connector. */
export const SwaggerModule = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  createDocument: (_app: any, config: Record<string, never>): unknown => config,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  setup: (_path: string, _app: any, _document: unknown): void => undefined,
};
