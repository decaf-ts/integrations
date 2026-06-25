import { Model, ModelConstructor } from "@decaf-ts/decorator-validation";
import request from "supertest";
import { toKebabCase } from "@decaf-ts/logging";

export interface HttpModelResponse<T> {
  pk: string;
  status: number;
  raw: any;
  data: T;
  toJSON(): T;
}

/**
 * HTTP client that sends a Bearer token with every request,
 * mirroring the for-nest e2e test's AuthHttpModelClient.
 */
export class AuthHttpModelClient<T extends Model> {
  private readonly path: string;
  private readonly server: request.SuperTest<request.Test>;

  constructor(
    private readonly app: any,
    private readonly Constr: ModelConstructor<T>
  ) {
    this.server = request(app);
    this.path = `/${toKebabCase(Model.tableName(Constr))}`;
  }

  private wrapResponse(body: any, status: number): HttpModelResponse<T> {
    const self = this as any;
    return {
      status,
      raw: body,
      data: status >= 200 && status < 300 ? new this.Constr(body) : undefined,
      get pk() {
        return this.data[Model.pk(self.Constr)] as string;
      },
      toJSON() {
        return this.data;
      },
    };
  }

  async post(body: Record<string, any>, token: string) {
    const res = await this.server
      .post(this.path)
      .send(body)
      .set("Authorization", `Bearer ${token}`);
    return this.wrapResponse(res.body, res.status);
  }

  async get(token: string, ...routeParams: string[]) {
    const res = await this.server
      .get(`${this.path}/${routeParams.join("/")}`)
      .set("Authorization", `Bearer ${token}`);
    return this.wrapResponse(res.body, res.status);
  }

  async put(
    body: Record<string, any>,
    token: string,
    ...routeParams: string[]
  ) {
    const res = await this.server
      .put(`${this.path}/${routeParams.join("/")}`)
      .set("Authorization", `Bearer ${token}`)
      .send(body);
    return this.wrapResponse(res.body, res.status);
  }

  async delete(token: string, ...routeParams: string[]) {
    const res = await this.server
      .delete(`${this.path}/${routeParams.join("/")}`)
      .set("Authorization", `Bearer ${token}`);
    return this.wrapResponse(res.body, res.status);
  }
}

export function genStr(len: number): string {
  return Math.floor(Math.random() * 1e14)
    .toString()
    .slice(0, len)
    .padStart(len, "1");
}
