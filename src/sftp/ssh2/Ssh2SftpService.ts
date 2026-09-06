import { service, type ContextualArgs, type MaybeContextualArg } from "@decaf-ts/core";
import { InternalError } from "@decaf-ts/db-decorators";
import {
  SftpSource,
  type SftpFileEntry,
  type SftpFileResult,
  type SftpSourceConfig,
  assertSftpConfig,
} from "../core/SftpSource";
import { Ssh2SftpEnvironment } from "./Ssh2SftpEnvironment";
import { envNumber, envString } from "../../shared/environmentValue";

export interface Ssh2SftpConfig extends SftpSourceConfig {
  provider: "ssh2";
  readyTimeout?: number;
}

interface Ssh2Client {
  connect(config: unknown): void;
  on(event: "ready", cb: () => void): void;
  on(event: "error", cb: (err: Error) => void): void;
  sftp(cb: (err: Error | null, sftp: Ssh2SftpHandle) => void): void;
  end(): void;
}

interface Ssh2SftpHandle {
  readdir(
    dir: string,
    cb: (
      err: Error | null,
      list: Array<{
        filename: string;
        attrs: { size: number; mtime: number; mode: number };
      }>
    ) => void
  ): void;
  stat(
    path: string,
    cb: (
      err: Error | null,
      stat: { size: number; mtime: number; mode: number }
    ) => void
  ): void;
  open(
    path: string,
    flags: string,
    cb: (err: Error | null, handle: Buffer) => void
  ): void;
  read(
    handle: Buffer,
    buffer: Buffer,
    offset: number,
    length: number,
    position: number,
    cb: (err: Error | null, bytesRead: number, buffer: Buffer) => void
  ): void;
  close(handle: Buffer, cb: (err: Error | null) => void): void;
  unlink(path: string, cb: (err: Error | null) => void): void;
  end(cb?: () => void): void;
}

@service("sftp-ssh2")
export class Ssh2SftpService extends SftpSource<Ssh2Client, Ssh2SftpConfig> {
  private sftp?: Ssh2SftpHandle;

  constructor() {
    super();
  }

  protected configFromEnvironment(): Ssh2SftpConfig | undefined {
    const env = Ssh2SftpEnvironment.sftp.ssh2;
    const host = envString(env?.host);
    const username = envString(env?.username);
    const password = envString(env?.password);
    const privateKey = envString(env?.privateKey);
    if (!host || !username || (!password && !privateKey)) return undefined;
    return {
      provider: "ssh2",
      sourceId: envString(env.sourceId) as string,
      host,
      port: envNumber(env.port),
      username,
      password,
      privateKey,
      passphrase: envString(env.passphrase),
      remotePath: envString(env.remotePath),
      readyTimeout: envNumber(env.readyTimeout),
    };
  }

  override async initialize(
    ...args: ContextualArgs<any>
  ): Promise<{ config: Ssh2SftpConfig; client: Ssh2Client }> {
    const config = this.getConfigFromArgs<Ssh2SftpConfig>(...args);
    assertSftpConfig(config);
    const Client = await import("ssh2")
      .then((m) => m.Client)
      .catch(() => {
        throw new InternalError(
          "ssh2 package not installed; run npm install ssh2"
        );
      });
    const client = new Client() as Ssh2Client;
    return new Promise((resolve, reject) => {
      client.on("error", (err: Error) =>
        reject(new InternalError(`SFTP connection error: ${err.message}`))
      );
      client.on("ready", () => {
        client.sftp((err, sftp) => {
          if (err)
            return reject(
              new InternalError(`SFTP subsystem error: ${err.message}`)
            );
          this.sftp = sftp;
          this._config = config;
          this._client = client;
          resolve({ config, client });
        });
      });
      client.connect({
        host: config.host,
        port: config.port ?? 22,
        username: config.username,
        password: config.password,
        privateKey: config.privateKey
          ? Buffer.from(config.privateKey)
          : undefined,
        passphrase: config.passphrase,
        readyTimeout: config.readyTimeout ?? 30_000,
      });
    });
  }

  override async list(
    remoteDir?: string,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    ...args: MaybeContextualArg<any>
  ): Promise<SftpFileEntry[]> {
    const dir = remoteDir ?? this.config.remotePath ?? ".";
    const sftp = this.requireSftp();
    return new Promise((resolve, reject) => {
      sftp.readdir(dir, (err, list) => {
        if (err)
          return reject(
            new InternalError(`SFTP readdir error: ${err.message}`)
          );
        resolve(
          list.map((entry) => ({
            path: `${dir}/${entry.filename}`,
            name: entry.filename,
            size: entry.attrs.size,
            modifyTime: entry.attrs.mtime * 1000,
            isDirectory: (entry.attrs.mode & 0o170000) === 0o040000,
          }))
        );
      });
    });
  }

  override async fetch(
    remotePath: string,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    ...args: MaybeContextualArg<any>
  ): Promise<SftpFileResult> {
    const sftp = this.requireSftp();
    const name = remotePath.split("/").pop() ?? remotePath;

    const stat = await new Promise<{
      size: number;
      mtime: number;
      mode: number;
    }>((resolve, reject) => {
      sftp.stat(remotePath, (err, st) => {
        if (err)
          return reject(new InternalError(`SFTP stat error: ${err.message}`));
        resolve(st);
      });
    });

    const handle = await new Promise<Buffer>((resolve, reject) => {
      sftp.open(remotePath, "r", (err, h) => {
        if (err)
          return reject(new InternalError(`SFTP open error: ${err.message}`));
        resolve(h);
      });
    });

    const chunkSize = 32_768;
    const chunks: Buffer[] = [];
    let position = 0;
    while (position < stat.size) {
      const buf = Buffer.alloc(Math.min(chunkSize, stat.size - position));
      const bytesRead = await new Promise<number>((resolve, reject) => {
        sftp.read(handle, buf, 0, buf.length, position, (err, n) => {
          if (err)
            return reject(new InternalError(`SFTP read error: ${err.message}`));
          resolve(n);
        });
      });
      chunks.push(Buffer.from(buf.buffer, 0, bytesRead));
      position += bytesRead;
      if (bytesRead === 0) break;
    }

    await new Promise<void>((resolve, reject) => {
      sftp.close(handle, (err) => {
        if (err)
          return reject(new InternalError(`SFTP close error: ${err.message}`));
        resolve();
      });
    });

    return {
      path: remotePath,
      name,
      content: Buffer.concat(chunks),
      size: stat.size,
    };
  }

  override async delete(
    remotePath: string,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    ...args: MaybeContextualArg<any>
  ): Promise<void> {
    const sftp = this.requireSftp();
    return new Promise((resolve, reject) => {
      sftp.unlink(remotePath, (err) => {
        if (err)
          return reject(new InternalError(`SFTP unlink error: ${err.message}`));
        resolve();
      });
    });
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  override async close(...args: MaybeContextualArg<any>): Promise<void> {
    this.sftp?.end();
    this.client?.end();
    this.sftp = undefined;
  }

  private requireSftp(): Ssh2SftpHandle {
    if (!this.sftp)
      throw new InternalError(
        "SftpSource not initialized; call initialize() first"
      );
    return this.sftp;
  }
}
