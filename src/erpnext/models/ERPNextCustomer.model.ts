import { column, index, pk, table } from "@decaf-ts/core";
import { description, uses } from "@decaf-ts/decoration";
import {
  Model,
  type ModelArg,
  email,
  model,
  option,
  required,
  type as typeOf,
} from "@decaf-ts/decorator-validation";
import {
  uielement,
  uilistmodel,
  uilistprop,
  uimodel,
} from "@decaf-ts/ui-decorators";
import { ERPNextFlavour } from "../constants";

/**
 * @description Allowed ERPNext customer types
 * @summary Mirrors the Frappe `Customer.customer_type` select options.
 * @const ERPNextCustomerTypeOptions
 * @memberOf module:erpnext
 */
export const ERPNextCustomerTypeOptions = ["Company", "Individual"] as const;

/**
 * @description ERPNext `Customer` doctype as a decaf model
 * @summary Seed model for the ERPNext adapter. The primary key is the Frappe
 * document `name`; every persisted attribute maps to the identically named
 * Customer field. It is decorated for validation and for the default for-angular
 * CRUD form and list item components.
 * @class ERPNextCustomer
 * @category ERPNext
 * @example
 * ```typescript
 * const customer = new ERPNextCustomer({
 *   customer_name: "ACME Ltd",
 *   customer_type: "Company",
 * });
 * await Repository.forModel(ERPNextCustomer).create(customer);
 * ```
 */
@uses(ERPNextFlavour)
@description("ERPNext Customer doctype")
@table("Customer")
@uimodel("ngx-decaf-crud-form")
@uilistmodel("ngx-decaf-list-item", { icon: "ti-user" })
@model()
export class ERPNextCustomer extends Model {
  constructor(data?: ModelArg<ERPNextCustomer>) {
    super(data);
  }

  @description("ERPNext document name")
  @pk({ type: String, generated: true })
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.customer.name.label",
    placeholder: "erpnext.customer.name.placeholder",
  })
  @uilistprop("title")
  name!: string;

  @description("Display name of the customer")
  @required()
  @typeOf(String)
  @index()
  @column()
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.customer.customerName.label",
    placeholder: "erpnext.customer.customerName.placeholder",
  })
  @uilistprop("description")
  customer_name!: string;

  @description("Company or individual")
  @option([...ERPNextCustomerTypeOptions])
  @column()
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.customer.customerType.label",
    type: "select",
    options: ERPNextCustomerTypeOptions.map((value) => ({ text: value, value })),
  })
  customer_type?: string;

  @description("Frappe customer group")
  @column()
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.customer.customerGroup.label",
  })
  customer_group?: string;

  @description("Frappe territory")
  @column()
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.customer.territory.label",
  })
  territory?: string;

  @description("Primary contact email")
  @email()
  @column()
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.customer.email.label",
    type: "email",
  })
  customer_email?: string;

  @description("Primary mobile number")
  @column()
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.customer.mobileNo.label",
    type: "tel",
  })
  mobile_no?: string;

  @description("Default billing currency")
  @column()
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.customer.currency.label",
  })
  default_currency?: string;

  @description("Whether the customer is disabled in ERPNext")
  @column()
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.customer.disabled.label",
    type: "checkbox",
  })
  disabled?: boolean;

  @description("Frappe creation timestamp")
  @column("creation")
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.customer.creation.label",
    type: "datetime-local",
  })
  creation?: Date;

  @description("Frappe last modification timestamp")
  @column("modified")
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.customer.modified.label",
    type: "datetime-local",
  })
  modified?: Date;

  @description("Frappe owner user")
  @column()
  owner?: string;

  @description("Frappe last modifying user")
  @column("modified_by")
  modified_by?: string;
}
