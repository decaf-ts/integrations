import { InternalError } from "@decaf-ts/db-decorators";

type ProductionResolver = () => boolean;

let kibanaProductionResolver: ProductionResolver | undefined;

export function setKibanaProductionResolver(
  resolver: ProductionResolver
): void {
  kibanaProductionResolver = resolver;
}

export function resolveKibanaIsProduction(
  config?: { isProduction?: () => boolean }
): boolean {
  if (typeof config?.isProduction === "function") {
    return config.isProduction();
  }
  if (kibanaProductionResolver) {
    return kibanaProductionResolver();
  }
  throw new InternalError("Kibana production resolver not initialized");
}
