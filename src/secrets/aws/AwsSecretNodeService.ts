/**
 * @module integrations/secrets/aws/node-service
 * @summary Non-Environment node variant of the AWS Secrets Manager.
 * @description Exposes `{@link AwsSecretNodeService}` for explicit `boot(config)` usage in
 * node contexts. It extends the undecorated `AwsSecretService` implementation resolved
 * via `serviceImplementation("secret-aws", AwsSecretService)` rather than the
 * `@service("secret-aws")`-decorated export, carries no `@service()` decorator,
 * and reads no Environment configuration.
 */

import { nonEnvironmentService, serviceImplementation } from "../../shared/node-service";
import { AwsSecretService } from "./AwsSecretService";

const AwsSecretBase = serviceImplementation("secret-aws", AwsSecretService);

/**
 * @description Non-Environment node variant of the AWS Secrets Manager
 * @summary Standalone subclass of the undecorated `AwsSecretService` implementation,
 * resolved through `serviceImplementation("secret-aws", AwsSecretService)` so the node
 * subclass extends the real constructor instead of the injectable factory
 * that `@service(...)` installs on the decorated export. It is the
 * non-Environment counterpart of `@service("secret-aws")`-decorated
 * `{@link AwsSecretService}`: the original remains registered and
 * Environment-configurable (the `secrets.aws` slice) for infrastructure boot,
 * while this subclass:
 *
 * - is **not** `@service()`-decorated: it is not registered in
 *   `Injectables`, not a singleton, and never auto-booted by static
 *   `Service.boot()`;
 * - reads no Environment configuration, so it must be initialized
 *   explicitly with `await instance.boot(config)`;
 * - rejects a no-argument or `Context`-only boot with a `ValidationError`
 *   (from `explicitNodeConfig`) because no Environment fallback exists.
 *
 * The secret provider is fixed by the subclass to `"aws-secrets-manager"` and overrides
 * any `provider` present in the supplied configuration.
 *
 * Once booted, instances expose the full `AwsSecretService` API.
 * @class AwsSecretNodeService
 * @category Secrets
 * @example
 * ```ts
 * import { AwsSecretNodeService } from "@decaf-ts/integrations/secrets/aws";
 *
 * const awsSecrets = await new AwsSecretNodeService().boot({
 *   region: "eu-west-1",
 * });
 * ```
 * @memberOf module:integrations/secrets/aws/node-service
 */
export class AwsSecretNodeService extends nonEnvironmentService(
  AwsSecretBase,
  "aws-secrets-manager"
) {}
