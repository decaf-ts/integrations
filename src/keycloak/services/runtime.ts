import { InternalError } from "@decaf-ts/db-decorators";

type ProductionResolver = () => boolean;

let keycloakProductionResolver: ProductionResolver | undefined;

export function setKeycloakProductionResolver(
  resolver: ProductionResolver
): void {
  keycloakProductionResolver = resolver;
}

export function resolveKeycloakIsProduction(
  config?: { isProduction?: () => boolean }
): boolean {
  if (typeof config?.isProduction === "function") {
    return config.isProduction();
  }
  if (keycloakProductionResolver) {
    return keycloakProductionResolver();
  }
  throw new InternalError("Keycloak production resolver not initialized");
}
