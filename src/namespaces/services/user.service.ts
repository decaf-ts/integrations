import { BaseModelService } from "../utils";
import { CreateUserInput } from "../types";
import { User } from "../models/user.model";

export class UserService extends BaseModelService<User> {
  constructor() {
    super(User);
  }

  async createUser(input: CreateUserInput, ...args: any[]): Promise<User> {
    return this.create(
      {
        email: input.email,
        phone: input.phone,
        displayName: input.displayName,
      },
      ...args
    );
  }

  async getByEmail(email: string, ...args: any[]): Promise<User> {
    return (await this.listAll(...args)).find((user) => user.email === email) as User;
  }

  async updateDisplayName(userId: string, displayName: string, ...args: any[]): Promise<User> {
    return this.updateOne(userId, { displayName }, ...args);
  }

  async updateEmail(userId: string, email: string | undefined, ...args: any[]): Promise<User> {
    return this.updateOne(userId, { email }, ...args);
  }

  async updatePhone(userId: string, phone: string | undefined, ...args: any[]): Promise<User> {
    return this.updateOne(userId, { phone }, ...args);
  }
}
