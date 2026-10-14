import { ValidationError } from "@decaf-ts/db-decorators";
import type { Constructor } from "@decaf-ts/decoration";

import { ObjectLoader } from "./ObjectLoader";
import type {
  ObjectLoaderFamily,
  ObjectLoaderLoadOptions,
  ObjectLoaderOptions,
  ObjectLoaderSource,
} from "./types";

/**
 * @summary Assert a loaded export is a constructor.
 * @description Concrete class loaders (models, services, Nest controllers) only
 * make sense for constructor exports. Throwing a decaf {@link ValidationError}
 * keeps the failure inside the decaf error hierarchy instead of a raw `Error`.
 */
export function assertConstructor<T extends Constructor = Constructor>(
  value: unknown,
  family: ObjectLoaderFamily,
  source: string,
  exportName: string
): T {
  if (typeof value !== "function") {
    throw new ValidationError(
      `Loaded ${family} export "${exportName}" from "${source}" is not a constructor.`
    );
  }
  return value as T;
}

/**
 * Concrete model loader. Resolves a model constructor from a module source and
 * runs the shared hook pipeline before returning it.
 */
export class ModelObjectLoader extends ObjectLoader {
  public constructor(options: ObjectLoaderOptions = {}) {
    super({ ...options, family: "model" });
  }

  public async loadModel<T extends Constructor = Constructor>(
    source: ObjectLoaderSource,
    exportName: string = this.defaultExportName,
    options: ObjectLoaderLoadOptions = {}
  ): Promise<T> {
    const value = await this.loadExport<unknown>(source, exportName, options);
    return assertConstructor<T>(
      value,
      this.family,
      this.normalizeSource(source),
      exportName
    );
  }
}

export class AdapterObjectLoader extends ObjectLoader {
  public constructor(options: ObjectLoaderOptions = {}) {
    super({ ...options, family: "adapter" });
  }

  public async loadAdapter<T = unknown>(
    source: ObjectLoaderSource,
    exportName: string = this.defaultExportName,
    options: ObjectLoaderLoadOptions = {}
  ): Promise<T> {
    return this.loadExport<T>(source, exportName, options);
  }
}

export class RepositoryObjectLoader extends ObjectLoader {
  public constructor(options: ObjectLoaderOptions = {}) {
    super({ ...options, family: "repository" });
  }

  public async loadRepository<T = unknown>(
    source: ObjectLoaderSource,
    exportName: string = this.defaultExportName,
    options: ObjectLoaderLoadOptions = {}
  ): Promise<T> {
    return this.loadExport<T>(source, exportName, options);
  }
}

/**
 * Concrete service loader. Resolves a service constructor from a module source and
 * runs the shared hook pipeline before returning it.
 */
export class ServiceObjectLoader extends ObjectLoader {
  public constructor(options: ObjectLoaderOptions = {}) {
    super({ ...options, family: "service" });
  }

  public async loadService<T extends Constructor = Constructor>(
    source: ObjectLoaderSource,
    exportName: string = this.defaultExportName,
    options: ObjectLoaderLoadOptions = {}
  ): Promise<T> {
    const value = await this.loadExport<unknown>(source, exportName, options);
    return assertConstructor<T>(
      value,
      this.family,
      this.normalizeSource(source),
      exportName
    );
  }
}

export class ControllerObjectLoader extends ObjectLoader {
  public constructor(options: ObjectLoaderOptions = {}) {
    super({ ...options, family: "controller" });
  }

  public async loadController<T = unknown>(
    source: ObjectLoaderSource,
    exportName: string = this.defaultExportName,
    options: ObjectLoaderLoadOptions = {}
  ): Promise<T> {
    return this.loadExport<T>(source, exportName, options);
  }
}

export class EnvironmentObjectLoader extends ObjectLoader {
  public constructor(options: ObjectLoaderOptions = {}) {
    super({ ...options, family: "environment" });
  }

  public async loadEnvironment<T = unknown>(
    source: ObjectLoaderSource,
    exportName: string = this.defaultExportName,
    options: ObjectLoaderLoadOptions = {}
  ): Promise<T> {
    return this.loadExport<T>(source, exportName, options);
  }
}

export class AngularComponentObjectLoader extends ObjectLoader {
  public constructor(options: ObjectLoaderOptions = {}) {
    super({ ...options, family: "component" });
  }

  public async loadComponent<T = unknown>(
    source: ObjectLoaderSource,
    exportName: string = this.defaultExportName,
    options: ObjectLoaderLoadOptions = {}
  ): Promise<T> {
    return this.loadExport<T>(source, exportName, options);
  }
}
