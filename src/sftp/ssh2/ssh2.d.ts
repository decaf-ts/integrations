/**
 * Minimal ambient declaration for the optional `ssh2` dependency. `ssh2` is an
 * {@link https://docs.npmjs.com/cli/v10/configuring-npm/package-json#optionaldependencies optionalDependency}:
 * it is present in portability deployments and absent in AWS-centric ones, so
 * the adapter resolves it with a dynamic `import("ssh2")` and a runtime
 * fallback. Declaring the module here lets TypeScript type-check the dynamic
 * import whether or not `ssh2` is installed in `node_modules`; the loaded
 * client is immediately narrowed to the local {@link Ssh2Client} contract, so
 * only the `Client` export is needed here.
 */
declare module "ssh2" {
  export class Client {
    constructor();
    connect(config: unknown): void;
    on(event: string, listener: (...args: unknown[]) => void): this;
    end(): void;
    sftp(cb: (err: Error | null, sftp: unknown) => void): void;
  }
}
