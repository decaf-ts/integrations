import "reflect-metadata";
import { Controller, Get, Module, Post } from "@nestjs/common";

class UsersController {
  find(id) {
    return { id };
  }

  create(payload) {
    return payload;
  }
}

UsersController.prototype.find = function find(id) {
  return { id };
};

UsersController.prototype.create = function create(payload) {
  return payload;
};

Controller("users")(UsersController);
Get(":id")(
  UsersController.prototype,
  "find",
  Object.getOwnPropertyDescriptor(UsersController.prototype, "find")
);
Post()(
  UsersController.prototype,
  "create",
  Object.getOwnPropertyDescriptor(UsersController.prototype, "create")
);

class HealthController {
  check() {
    return "ok";
  }
}

HealthController.prototype.check = function check() {
  return "ok";
};

Controller("health")(HealthController);
Get()(
  HealthController.prototype,
  "check",
  Object.getOwnPropertyDescriptor(HealthController.prototype, "check")
);

class FeatureModule {}
Module({ controllers: [HealthController] })(FeatureModule);

class AppModule {}
Module({ controllers: [UsersController], imports: [FeatureModule] })(AppModule);

class PlainClass {
  doThing() {
    return "plain";
  }
}

export {
  UsersController,
  HealthController,
  FeatureModule,
  AppModule,
  PlainClass,
};
export const plainThing = { label: "plain" };
export default UsersController;
