import { ObjectLoader } from "./ObjectLoader";
import type {
  ObjectLoaderLoadOptions,
  ObjectLoaderOptions,
  ObjectLoaderSource,
} from "./types";

export class ModelObjectLoader extends ObjectLoader {
  public constructor(options: ObjectLoaderOptions = {}) {
    super({ ...options, family: "model" });
  }

  public async loadModel<T = unknown>(
    source: ObjectLoaderSource,
    exportName: string = this.defaultExportName,
    options: ObjectLoaderLoadOptions = {}
  ): Promise<T> {
    return this.loadExport<T>(source, exportName, options);
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

export class ServiceObjectLoader extends ObjectLoader {
  public constructor(options: ObjectLoaderOptions = {}) {
    super({ ...options, family: "service" });
  }

  public async loadService<T = unknown>(
    source: ObjectLoaderSource,
    exportName: string = this.defaultExportName,
    options: ObjectLoaderLoadOptions = {}
  ): Promise<T> {
    return this.loadExport<T>(source, exportName, options);
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

export class GraphNodeObjectLoader extends ObjectLoader {
  public constructor(options: ObjectLoaderOptions = {}) {
    super({ ...options, family: "node" });
  }

  public async loadNode<T = unknown>(
    source: ObjectLoaderSource,
    exportName: string = this.defaultExportName,
    options: ObjectLoaderLoadOptions = {}
  ): Promise<T> {
    return this.loadExport<T>(source, exportName, options);
  }
}
