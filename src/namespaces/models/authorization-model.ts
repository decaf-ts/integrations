import { Model } from "@decaf-ts/decorator-validation";

export abstract class AuthorizationModel extends Model {
  constructor(data?: unknown) {
    super(data as never);
  }
}
