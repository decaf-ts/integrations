import { column, index, pk, table } from "@decaf-ts/core";
import { description, uses } from "@decaf-ts/decoration";
import {
  Model,
  type ModelArg,
  list,
  max,
  min,
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
 * @description Allowed targets a pricing rule applies to
 * @summary Mirrors the Frappe `Pricing Rule.apply_on` select options.
 * @const ERPNextApplyOnOptions
 * @memberOf module:erpnext
 */
export const ERPNextApplyOnOptions = [
  "Item Code",
  "Item Group",
  "Brand",
  "Transaction",
] as const;

/**
 * @description Allowed secondary targets for a pricing rule
 * @summary Mirrors the Frappe `Pricing Rule.apply_rule_on_other` options.
 * @const ERPNextApplyRuleOnOtherOptions
 * @memberOf module:erpnext
 */
export const ERPNextApplyRuleOnOtherOptions = [
  "Item Code",
  "Item Group",
  "Brand",
] as const;

/**
 * @description Allowed price-or-product discount modes
 * @summary Mirrors the Frappe `Promotional Scheme.price_or_product_discount`
 * options.
 * @const ERPNextPriceOrProductDiscountOptions
 * @memberOf module:erpnext
 */
export const ERPNextPriceOrProductDiscountOptions = [
  "Price",
  "Product",
] as const;

/**
 * @description Allowed parties a promotion is applicable for
 * @summary Mirrors the Frappe `Promotional Scheme.applicable_for` options.
 * @const ERPNextApplicableForOptions
 * @memberOf module:erpnext
 */
export const ERPNextApplicableForOptions = [
  "Customer",
  "Customer Group",
  "Territory",
  "Sales Partner",
  "Campaign",
  "Supplier",
  "Supplier Group",
] as const;

/**
 * @description Allowed rate or discount modes
 * @summary Mirrors the Frappe `rate_or_discount` select options shared by pricing
 * rules and promotional scheme rows.
 * @const ERPNextRateOrDiscountOptions
 * @memberOf module:erpnext
 */
export const ERPNextRateOrDiscountOptions = [
  "Rate",
  "Discount Percentage",
  "Discount Amount",
] as const;

/**
 * @description Allowed margin types
 * @summary Mirrors the Frappe `margin_type` select options.
 * @const ERPNextMarginTypeOptions
 * @memberOf module:erpnext
 */
export const ERPNextMarginTypeOptions = ["Percentage", "Amount"] as const;

/**
 * @description Allowed coupon types
 * @summary Mirrors the Frappe `Coupon Code.coupon_type` select options.
 * @const ERPNextCouponTypeOptions
 * @memberOf module:erpnext
 */
export const ERPNextCouponTypeOptions = ["Promotional", "Gift Card"] as const;

/**
 * @description ERPNext `Pricing Rule Item Code` child doctype as a decaf model
 * @summary Child row restricting a pricing rule to a specific item code and UOM.
 * @class ERPNextPricingRuleItemCode
 * @category ERPNext
 */
@description("ERPNext Pricing Rule Item Code child row")
@uimodel("ngx-decaf-crud-form")
@model()
export class ERPNextPricingRuleItemCode extends Model {
  constructor(data?: ModelArg<ERPNextPricingRuleItemCode>) {
    super(data);
  }

  @description("Item code the rule applies to")
  @typeOf(String)
  @column()
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.pricingRuleItemCode.itemCode.label",
  })
  item_code?: string;

  @description("Unit of measure")
  @column()
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.pricingRuleItemCode.uom.label",
  })
  uom?: string;
}

/**
 * @description ERPNext `Pricing Rule Item Group` child doctype as a decaf model
 * @summary Child row restricting a pricing rule to an item group and UOM.
 * @class ERPNextPricingRuleItemGroup
 * @category ERPNext
 */
@description("ERPNext Pricing Rule Item Group child row")
@uimodel("ngx-decaf-crud-form")
@model()
export class ERPNextPricingRuleItemGroup extends Model {
  constructor(data?: ModelArg<ERPNextPricingRuleItemGroup>) {
    super(data);
  }

  @description("Item group the rule applies to")
  @typeOf(String)
  @column()
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.pricingRuleItemGroup.itemGroup.label",
  })
  item_group?: string;

  @description("Unit of measure")
  @column()
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.pricingRuleItemGroup.uom.label",
  })
  uom?: string;
}

/**
 * @description ERPNext `Pricing Rule Brand` child doctype as a decaf model
 * @summary Child row restricting a pricing rule to a brand and UOM.
 * @class ERPNextPricingRuleBrand
 * @category ERPNext
 */
@description("ERPNext Pricing Rule Brand child row")
@uimodel("ngx-decaf-crud-form")
@model()
export class ERPNextPricingRuleBrand extends Model {
  constructor(data?: ModelArg<ERPNextPricingRuleBrand>) {
    super(data);
  }

  @description("Brand the rule applies to")
  @typeOf(String)
  @column()
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.pricingRuleBrand.brand.label",
  })
  brand?: string;

  @description("Unit of measure")
  @column()
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.pricingRuleBrand.uom.label",
  })
  uom?: string;
}

/**
 * @description ERPNext `Promotional Scheme Price Discount` child doctype
 * @summary Child row holding the price-discount conditions of a promotional scheme.
 * @class ERPNextPromotionalSchemePriceDiscount
 * @category ERPNext
 */
@description("ERPNext Promotional Scheme Price Discount child row")
@uimodel("ngx-decaf-crud-form")
@model()
export class ERPNextPromotionalSchemePriceDiscount extends Model {
  constructor(data?: ModelArg<ERPNextPromotionalSchemePriceDiscount>) {
    super(data);
  }

  @description("Disable this discount slab")
  @column()
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.promotionalSchemePriceDiscount.disable.label",
    type: "checkbox",
  })
  disable?: boolean;

  @description("Apply multiple pricing rules for this slab")
  @column()
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.promotionalSchemePriceDiscount.applyMultiplePricingRules.label",
    type: "checkbox",
  })
  apply_multiple_pricing_rules?: boolean;

  @description("Slab description")
  @required()
  @typeOf(String)
  @column()
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.promotionalSchemePriceDiscount.ruleDescription.label",
  })
  rule_description!: string;

  @description("Minimum quantity")
  @min(0)
  @column()
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.promotionalSchemePriceDiscount.minQty.label",
    type: "number",
  })
  min_qty?: number;

  @description("Maximum quantity")
  @min(0)
  @column()
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.promotionalSchemePriceDiscount.maxQty.label",
    type: "number",
  })
  max_qty?: number;

  @description("Minimum amount")
  @min(0)
  @column()
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.promotionalSchemePriceDiscount.minAmount.label",
    type: "number",
  })
  min_amount?: number;

  @description("Maximum amount")
  @min(0)
  @column()
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.promotionalSchemePriceDiscount.maxAmount.label",
    type: "number",
  })
  max_amount?: number;

  @description("Rate or discount mode")
  @option([...ERPNextRateOrDiscountOptions])
  @column()
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.promotionalSchemePriceDiscount.rateOrDiscount.label",
    type: "select",
    options: ERPNextRateOrDiscountOptions.map((value) => ({
      text: value,
      value,
    })),
  })
  rate_or_discount?: string;

  @description("Fixed rate")
  @min(0)
  @column()
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.promotionalSchemePriceDiscount.rate.label",
    type: "number",
  })
  rate?: number;

  @description("Discount amount")
  @min(0)
  @column()
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.promotionalSchemePriceDiscount.discountAmount.label",
    type: "number",
  })
  discount_amount?: number;

  @description("Discount percentage")
  @min(0)
  @max(100)
  @column()
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.promotionalSchemePriceDiscount.discountPercentage.label",
    type: "number",
  })
  discount_percentage?: number;

  @description("Price list the slab applies to")
  @column()
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.promotionalSchemePriceDiscount.forPriceList.label",
  })
  for_price_list?: string;

  @description("Warehouse the slab applies to")
  @column()
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.promotionalSchemePriceDiscount.warehouse.label",
  })
  warehouse?: string;

  @description("Threshold percentage")
  @min(0)
  @max(100)
  @column()
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.promotionalSchemePriceDiscount.thresholdPercentage.label",
    type: "number",
  })
  threshold_percentage?: number;

  @description("Validate the applied rule")
  @column()
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.promotionalSchemePriceDiscount.validateAppliedRule.label",
    type: "checkbox",
  })
  validate_applied_rule?: boolean;

  @description("Slab priority")
  @min(1)
  @max(20)
  @column()
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.promotionalSchemePriceDiscount.priority.label",
    type: "number",
  })
  priority?: number;

  @description("Apply the discount on the rate")
  @column()
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.promotionalSchemePriceDiscount.applyDiscountOnRate.label",
    type: "checkbox",
  })
  apply_discount_on_rate?: boolean;
}

/**
 * @description ERPNext `Promotional Scheme Product Discount` child doctype
 * @summary Child row holding the free-product conditions of a promotional scheme.
 * @class ERPNextPromotionalSchemeProductDiscount
 * @category ERPNext
 */
@description("ERPNext Promotional Scheme Product Discount child row")
@uimodel("ngx-decaf-crud-form")
@model()
export class ERPNextPromotionalSchemeProductDiscount extends Model {
  constructor(data?: ModelArg<ERPNextPromotionalSchemeProductDiscount>) {
    super(data);
  }

  @description("Disable this discount slab")
  @column()
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.promotionalSchemeProductDiscount.disable.label",
    type: "checkbox",
  })
  disable?: boolean;

  @description("Apply multiple pricing rules for this slab")
  @column()
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.promotionalSchemeProductDiscount.applyMultiplePricingRules.label",
    type: "checkbox",
  })
  apply_multiple_pricing_rules?: boolean;

  @description("Slab description")
  @required()
  @typeOf(String)
  @column()
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.promotionalSchemeProductDiscount.ruleDescription.label",
  })
  rule_description!: string;

  @description("Minimum quantity")
  @min(0)
  @column()
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.promotionalSchemeProductDiscount.minQty.label",
    type: "number",
  })
  min_qty?: number;

  @description("Maximum quantity")
  @min(0)
  @column()
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.promotionalSchemeProductDiscount.maxQty.label",
    type: "number",
  })
  max_qty?: number;

  @description("Minimum amount")
  @min(0)
  @column()
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.promotionalSchemeProductDiscount.minAmount.label",
    type: "number",
  })
  min_amount?: number;

  @description("Maximum amount")
  @min(0)
  @column()
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.promotionalSchemeProductDiscount.maxAmount.label",
    type: "number",
  })
  max_amount?: number;

  @description("Give away the same item")
  @column()
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.promotionalSchemeProductDiscount.sameItem.label",
    type: "checkbox",
  })
  same_item?: boolean;

  @description("Free item granted by the slab")
  @column()
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.promotionalSchemeProductDiscount.freeItem.label",
  })
  free_item?: string;

  @description("Free item quantity")
  @min(0)
  @column()
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.promotionalSchemeProductDiscount.freeQty.label",
    type: "number",
  })
  free_qty?: number;

  @description("Free item unit of measure")
  @column()
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.promotionalSchemeProductDiscount.freeItemUom.label",
  })
  free_item_uom?: string;

  @description("Free item rate")
  @min(0)
  @column()
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.promotionalSchemeProductDiscount.freeItemRate.label",
    type: "number",
  })
  free_item_rate?: number;

  @description("Round the free quantity")
  @column()
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.promotionalSchemeProductDiscount.roundFreeQty.label",
    type: "checkbox",
  })
  round_free_qty?: boolean;

  @description("Warehouse the slab applies to")
  @column()
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.promotionalSchemeProductDiscount.warehouse.label",
  })
  warehouse?: string;

  @description("Threshold percentage")
  @min(0)
  @max(100)
  @column()
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.promotionalSchemeProductDiscount.thresholdPercentage.label",
    type: "number",
  })
  threshold_percentage?: number;

  @description("Slab priority")
  @min(1)
  @max(20)
  @column()
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.promotionalSchemeProductDiscount.priority.label",
    type: "number",
  })
  priority?: number;

  @description("Apply the free item recursively")
  @column()
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.promotionalSchemeProductDiscount.isRecursive.label",
    type: "checkbox",
  })
  is_recursive?: boolean;

  @description("Recursion quantity")
  @min(0)
  @column()
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.promotionalSchemeProductDiscount.recurseFor.label",
    type: "number",
  })
  recurse_for?: number;

  @description("Apply the recursion over amount")
  @min(0)
  @column()
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.promotionalSchemeProductDiscount.applyRecursionOver.label",
    type: "number",
  })
  apply_recursion_over?: number;
}

/**
 * @description ERPNext `Promotional Scheme` doctype as a decaf model
 * @summary Promotion definition with its price and product discount rows.
 * @class ERPNextPromotionalScheme
 * @category ERPNext
 */
@uses(ERPNextFlavour)
@description("ERPNext Promotional Scheme doctype")
@table("Promotional Scheme")
@uimodel("ngx-decaf-crud-form")
@uilistmodel("ngx-decaf-list-item", { icon: "ti-ticket" })
@model()
export class ERPNextPromotionalScheme extends Model {
  constructor(data?: ModelArg<ERPNextPromotionalScheme>) {
    super(data);
  }

  @description("ERPNext document name")
  @pk({ type: String, generated: true })
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.promotionalScheme.name.label",
    placeholder: "erpnext.promotionalScheme.name.placeholder",
  })
  @uilistprop("title")
  name!: string;

  @description("What the scheme applies to")
  @required()
  @option([...ERPNextApplyOnOptions])
  @index()
  @column()
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.promotionalScheme.applyOn.label",
    type: "select",
    options: ERPNextApplyOnOptions.map((value) => ({ text: value, value })),
  })
  @uilistprop("description")
  apply_on!: string;

  @description("Disable the scheme")
  @column()
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.promotionalScheme.disable.label",
    type: "checkbox",
  })
  disable?: boolean;

  @description("Items the scheme applies to")
  @column()
  @list(() => ERPNextPricingRuleItemCode)
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.promotionalScheme.items.label",
    options: () => ERPNextPricingRuleItemCode,
  })
  items?: ERPNextPricingRuleItemCode[];

  @description("Item groups the scheme applies to")
  @column()
  @list(() => ERPNextPricingRuleItemGroup)
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.promotionalScheme.itemGroups.label",
    options: () => ERPNextPricingRuleItemGroup,
  })
  item_groups?: ERPNextPricingRuleItemGroup[];

  @description("Brands the scheme applies to")
  @column()
  @list(() => ERPNextPricingRuleBrand)
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.promotionalScheme.brands.label",
    options: () => ERPNextPricingRuleBrand,
  })
  brands?: ERPNextPricingRuleBrand[];

  @description("Mix conditions across items")
  @column()
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.promotionalScheme.mixedConditions.label",
    type: "checkbox",
  })
  mixed_conditions?: boolean;

  @description("Make the scheme cumulative with other rules")
  @column()
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.promotionalScheme.isCumulative.label",
    type: "checkbox",
  })
  is_cumulative?: boolean;

  @description("Secondary target the scheme applies to")
  @option([...ERPNextApplyRuleOnOtherOptions])
  @column()
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.promotionalScheme.applyRuleOnOther.label",
    type: "select",
    options: ERPNextApplyRuleOnOtherOptions.map((value) => ({
      text: value,
      value,
    })),
  })
  apply_rule_on_other?: string;

  @description("Other item code")
  @column()
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.promotionalScheme.otherItemCode.label",
  })
  other_item_code?: string;

  @description("Other item group")
  @column()
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.promotionalScheme.otherItemGroup.label",
  })
  other_item_group?: string;

  @description("Other brand")
  @column()
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.promotionalScheme.otherBrand.label",
  })
  other_brand?: string;

  @description("Applies to selling transactions")
  @column()
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.promotionalScheme.selling.label",
    type: "checkbox",
  })
  selling?: boolean;

  @description("Applies to buying transactions")
  @column()
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.promotionalScheme.buying.label",
    type: "checkbox",
  })
  buying?: boolean;

  @description("Party the scheme is restricted to")
  @option([...ERPNextApplicableForOptions])
  @column()
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.promotionalScheme.applicableFor.label",
    type: "select",
    options: ERPNextApplicableForOptions.map((value) => ({
      text: value,
      value,
    })),
  })
  applicable_for?: string;

  @description("Scheme validity start")
  @typeOf(Date)
  @index()
  @column()
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.promotionalScheme.validFrom.label",
    type: "date",
  })
  valid_from?: Date;

  @description("Scheme validity end")
  @typeOf(Date)
  @column()
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.promotionalScheme.validUpto.label",
    type: "date",
  })
  valid_upto?: Date;

  @description("Company owning the scheme")
  @required()
  @typeOf(String)
  @index()
  @column()
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.promotionalScheme.company.label",
  })
  company!: string;

  @description("Scheme currency")
  @column()
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.promotionalScheme.currency.label",
  })
  currency?: string;

  @description("Price discount slabs")
  @column()
  @list(() => ERPNextPromotionalSchemePriceDiscount)
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.promotionalScheme.priceDiscountSlabs.label",
    options: () => ERPNextPromotionalSchemePriceDiscount,
  })
  price_discount_slabs?: ERPNextPromotionalSchemePriceDiscount[];

  @description("Product discount slabs")
  @column()
  @list(() => ERPNextPromotionalSchemeProductDiscount)
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.promotionalScheme.productDiscountSlabs.label",
    options: () => ERPNextPromotionalSchemeProductDiscount,
  })
  product_discount_slabs?: ERPNextPromotionalSchemeProductDiscount[];

  @description("Frappe creation timestamp")
  @column("creation")
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.promotionalScheme.creation.label",
    type: "datetime-local",
  })
  creation?: Date;

  @description("Frappe last modification timestamp")
  @column("modified")
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.promotionalScheme.modified.label",
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

/**
 * @description ERPNext `Pricing Rule` doctype as a decaf model
 * @summary Rule that prices, discounts or margins items at transaction time.
 * @class ERPNextPricingRule
 * @category ERPNext
 */
@uses(ERPNextFlavour)
@description("ERPNext Pricing Rule doctype")
@table("Pricing Rule")
@uimodel("ngx-decaf-crud-form")
@uilistmodel("ngx-decaf-list-item", { icon: "ti-ruler" })
@model()
export class ERPNextPricingRule extends Model {
  constructor(data?: ModelArg<ERPNextPricingRule>) {
    super(data);
  }

  @description("ERPNext document name")
  @pk({ type: String, generated: true })
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.pricingRule.name.label",
    placeholder: "erpnext.pricingRule.name.placeholder",
  })
  @uilistprop("title")
  name!: string;

  @description("Pricing rule title")
  @required()
  @typeOf(String)
  @index()
  @column()
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.pricingRule.title.label",
  })
  @uilistprop("description")
  title!: string;

  @description("Disable the rule")
  @column()
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.pricingRule.disable.label",
    type: "checkbox",
  })
  disable?: boolean;

  @description("What the rule applies to")
  @required()
  @option([...ERPNextApplyOnOptions])
  @index()
  @column()
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.pricingRule.applyOn.label",
    type: "select",
    options: ERPNextApplyOnOptions.map((value) => ({ text: value, value })),
  })
  apply_on!: string;

  @description("Whether the rule prices or grants a product")
  @required()
  @option([...ERPNextPriceOrProductDiscountOptions])
  @column()
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.pricingRule.priceOrProductDiscount.label",
    type: "select",
    options: ERPNextPriceOrProductDiscountOptions.map((value) => ({
      text: value,
      value,
    })),
  })
  price_or_product_discount!: string;

  @description("Warehouse restriction")
  @column()
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.pricingRule.warehouse.label",
  })
  warehouse?: string;

  @description("Items the rule applies to")
  @column()
  @list(() => ERPNextPricingRuleItemCode)
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.pricingRule.items.label",
    options: () => ERPNextPricingRuleItemCode,
  })
  items?: ERPNextPricingRuleItemCode[];

  @description("Item groups the rule applies to")
  @column()
  @list(() => ERPNextPricingRuleItemGroup)
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.pricingRule.itemGroups.label",
    options: () => ERPNextPricingRuleItemGroup,
  })
  item_groups?: ERPNextPricingRuleItemGroup[];

  @description("Brands the rule applies to")
  @column()
  @list(() => ERPNextPricingRuleBrand)
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.pricingRule.brands.label",
    options: () => ERPNextPricingRuleBrand,
  })
  brands?: ERPNextPricingRuleBrand[];

  @description("Mix conditions across items")
  @column()
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.pricingRule.mixedConditions.label",
    type: "checkbox",
  })
  mixed_conditions?: boolean;

  @description("Make the rule cumulative with other rules")
  @column()
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.pricingRule.isCumulative.label",
    type: "checkbox",
  })
  is_cumulative?: boolean;

  @description("Rule is activated by a coupon code")
  @column()
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.pricingRule.couponCodeBased.label",
    type: "checkbox",
  })
  coupon_code_based?: boolean;

  @description("Secondary target the rule applies to")
  @option([...ERPNextApplyRuleOnOtherOptions])
  @column()
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.pricingRule.applyRuleOnOther.label",
    type: "select",
    options: ERPNextApplyRuleOnOtherOptions.map((value) => ({
      text: value,
      value,
    })),
  })
  apply_rule_on_other?: string;

  @description("Other item code")
  @column()
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.pricingRule.otherItemCode.label",
  })
  other_item_code?: string;

  @description("Other item group")
  @column()
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.pricingRule.otherItemGroup.label",
  })
  other_item_group?: string;

  @description("Other brand")
  @column()
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.pricingRule.otherBrand.label",
  })
  other_brand?: string;

  @description("Applies to selling transactions")
  @column()
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.pricingRule.selling.label",
    type: "checkbox",
  })
  selling?: boolean;

  @description("Applies to buying transactions")
  @column()
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.pricingRule.buying.label",
    type: "checkbox",
  })
  buying?: boolean;

  @description("Party the rule is restricted to")
  @option([...ERPNextApplicableForOptions])
  @column()
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.pricingRule.applicableFor.label",
    type: "select",
    options: ERPNextApplicableForOptions.map((value) => ({
      text: value,
      value,
    })),
  })
  applicable_for?: string;

  @description("Customer restriction")
  @column()
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.pricingRule.customer.label",
  })
  customer?: string;

  @description("Customer group restriction")
  @column()
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.pricingRule.customerGroup.label",
  })
  customer_group?: string;

  @description("Territory restriction")
  @column()
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.pricingRule.territory.label",
  })
  territory?: string;

  @description("Sales partner restriction")
  @column()
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.pricingRule.salesPartner.label",
  })
  sales_partner?: string;

  @description("Campaign restriction")
  @column()
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.pricingRule.campaign.label",
  })
  campaign?: string;

  @description("Supplier restriction")
  @column()
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.pricingRule.supplier.label",
  })
  supplier?: string;

  @description("Supplier group restriction")
  @column()
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.pricingRule.supplierGroup.label",
  })
  supplier_group?: string;

  @description("Minimum quantity")
  @min(0)
  @column()
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.pricingRule.minQty.label",
    type: "number",
  })
  min_qty?: number;

  @description("Maximum quantity")
  @min(0)
  @column()
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.pricingRule.maxQty.label",
    type: "number",
  })
  max_qty?: number;

  @description("Minimum amount")
  @min(0)
  @column()
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.pricingRule.minAmt.label",
    type: "number",
  })
  min_amt?: number;

  @description("Maximum amount")
  @min(0)
  @column()
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.pricingRule.maxAmt.label",
    type: "number",
  })
  max_amt?: number;

  @description("Free item must be the same as the bought item")
  @column()
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.pricingRule.sameItem.label",
    type: "checkbox",
  })
  same_item?: boolean;

  @description("Free item granted by the rule")
  @column()
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.pricingRule.freeItem.label",
  })
  free_item?: string;

  @description("Free item quantity")
  @min(0)
  @column()
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.pricingRule.freeQty.label",
    type: "number",
  })
  free_qty?: number;

  @description("Free item rate")
  @min(0)
  @column()
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.pricingRule.freeItemRate.label",
    type: "number",
  })
  free_item_rate?: number;

  @description("Free item unit of measure")
  @column()
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.pricingRule.freeItemUom.label",
  })
  free_item_uom?: string;

  @description("Round the free quantity")
  @column()
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.pricingRule.roundFreeQty.label",
    type: "checkbox",
  })
  round_free_qty?: boolean;

  @description("Do not enforce the free item quantity")
  @column()
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.pricingRule.dontEnforceFreeItemQty.label",
    type: "checkbox",
  })
  dont_enforce_free_item_qty?: boolean;

  @description("Apply the free item recursively")
  @column()
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.pricingRule.isRecursive.label",
    type: "checkbox",
  })
  is_recursive?: boolean;

  @description("Recursion quantity")
  @min(0)
  @column()
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.pricingRule.recurseFor.label",
    type: "number",
  })
  recurse_for?: number;

  @description("Apply the recursion over amount")
  @min(0)
  @column()
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.pricingRule.applyRecursionOver.label",
    type: "number",
  })
  apply_recursion_over?: number;

  @description("Rule validity start")
  @typeOf(Date)
  @index()
  @column()
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.pricingRule.validFrom.label",
    type: "date",
  })
  valid_from?: Date;

  @description("Rule validity end")
  @typeOf(Date)
  @column()
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.pricingRule.validUpto.label",
    type: "date",
  })
  valid_upto?: Date;

  @description("Company owning the rule")
  @index()
  @column()
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.pricingRule.company.label",
  })
  company?: string;

  @description("Rule currency")
  @required()
  @typeOf(String)
  @column()
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.pricingRule.currency.label",
  })
  currency!: string;

  @description("Margin type")
  @option([...ERPNextMarginTypeOptions])
  @column()
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.pricingRule.marginType.label",
    type: "select",
    options: ERPNextMarginTypeOptions.map((value) => ({ text: value, value })),
  })
  margin_type?: string;

  @description("Margin rate or amount")
  @column()
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.pricingRule.marginRateOrAmount.label",
    type: "number",
  })
  margin_rate_or_amount?: number;

  @description("Rate or discount mode")
  @option([...ERPNextRateOrDiscountOptions])
  @column()
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.pricingRule.rateOrDiscount.label",
    type: "select",
    options: ERPNextRateOrDiscountOptions.map((value) => ({
      text: value,
      value,
    })),
  })
  rate_or_discount?: string;

  @description("Apply the discount on")
  @option(["Grand Total", "Net Total"])
  @column()
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.pricingRule.applyDiscountOn.label",
    type: "select",
    options: ["Grand Total", "Net Total"].map((value) => ({
      text: value,
      value,
    })),
  })
  apply_discount_on?: string;

  @description("Fixed rate")
  @min(0)
  @column()
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.pricingRule.rate.label",
    type: "number",
  })
  rate?: number;

  @description("Discount amount")
  @min(0)
  @column()
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.pricingRule.discountAmount.label",
    type: "number",
  })
  discount_amount?: number;

  @description("Discount percentage")
  @min(0)
  @max(100)
  @column()
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.pricingRule.discountPercentage.label",
    type: "number",
  })
  discount_percentage?: number;

  @description("Price list the rule is restricted to")
  @column()
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.pricingRule.forPriceList.label",
  })
  for_price_list?: string;

  @description("Python expression condition")
  @column()
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.pricingRule.condition.label",
  })
  condition?: string;

  @description("Apply multiple pricing rules")
  @column()
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.pricingRule.applyMultiplePricingRules.label",
    type: "checkbox",
  })
  apply_multiple_pricing_rules?: boolean;

  @description("Apply the discount on the rate")
  @column()
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.pricingRule.applyDiscountOnRate.label",
    type: "checkbox",
  })
  apply_discount_on_rate?: boolean;

  @description("Threshold percentage")
  @min(0)
  @max(100)
  @column()
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.pricingRule.thresholdPercentage.label",
    type: "number",
  })
  threshold_percentage?: number;

  @description("Validate the applied rule")
  @column()
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.pricingRule.validateAppliedRule.label",
    type: "checkbox",
  })
  validate_applied_rule?: boolean;

  @description("Rule description")
  @column()
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.pricingRule.ruleDescription.label",
  })
  rule_description?: string;

  @description("Whether the rule has priority")
  @column()
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.pricingRule.hasPriority.label",
    type: "checkbox",
  })
  has_priority?: boolean;

  @description("Rule priority")
  @min(1)
  @max(20)
  @column()
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.pricingRule.priority.label",
    type: "number",
  })
  priority?: number;

  @description("Frappe creation timestamp")
  @column("creation")
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.pricingRule.creation.label",
    type: "datetime-local",
  })
  creation?: Date;

  @description("Frappe last modification timestamp")
  @column("modified")
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.pricingRule.modified.label",
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

/**
 * @description ERPNext `Coupon Code` doctype as a decaf model
 * @summary Redeemable coupon tied to a promotional scheme or carrying a gift-card
 * balance.
 * @class ERPNextCouponCode
 * @category ERPNext
 */
@uses(ERPNextFlavour)
@description("ERPNext Coupon Code doctype")
@table("Coupon Code")
@uimodel("ngx-decaf-crud-form")
@uilistmodel("ngx-decaf-list-item", { icon: "ti-tag" })
@model()
export class ERPNextCouponCode extends Model {
  constructor(data?: ModelArg<ERPNextCouponCode>) {
    super(data);
  }

  @description("ERPNext document name")
  @pk({ type: String, generated: true })
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.couponCode.name.label",
    placeholder: "erpnext.couponCode.name.placeholder",
  })
  @uilistprop("title")
  name!: string;

  @description("Coupon name")
  @required()
  @typeOf(String)
  @index()
  @column()
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.couponCode.couponName.label",
  })
  @uilistprop("description")
  coupon_name!: string;

  @description("Coupon type")
  @required()
  @option([...ERPNextCouponTypeOptions])
  @column()
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.couponCode.couponType.label",
    type: "select",
    options: ERPNextCouponTypeOptions.map((value) => ({
      text: value,
      value,
    })),
  })
  coupon_type!: string;

  @description("Customer the coupon is restricted to")
  @column()
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.couponCode.customer.label",
  })
  customer?: string;

  @description("Public coupon code")
  @typeOf(String)
  @index()
  @column()
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.couponCode.couponCode.label",
  })
  coupon_code?: string;

  @description("Pricing rule activated by the coupon")
  @required()
  @typeOf(String)
  @index()
  @column()
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.couponCode.pricingRule.label",
  })
  pricing_rule!: string;

  @description("Coupon validity start")
  @typeOf(Date)
  @index()
  @column()
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.couponCode.validFrom.label",
    type: "date",
  })
  valid_from?: Date;

  @description("Coupon validity end")
  @typeOf(Date)
  @column()
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.couponCode.validUpto.label",
    type: "date",
  })
  valid_upto?: Date;

  @description("Maximum number of uses")
  @min(0)
  @column()
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.couponCode.maximumUse.label",
    type: "number",
  })
  maximum_use?: number;

  @description("Number of times the coupon was used")
  @min(0)
  @column()
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.couponCode.used.label",
    type: "number",
  })
  used?: number;

  @description("Coupon description")
  @column()
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.couponCode.description.label",
  })
  description?: string;

  @description("Original coupon this one amends")
  @column()
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.couponCode.amendedFrom.label",
  })
  amended_from?: string;

  @description("Frappe creation timestamp")
  @column("creation")
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.couponCode.creation.label",
    type: "datetime-local",
  })
  creation?: Date;

  @description("Frappe last modification timestamp")
  @column("modified")
  @uielement("ngx-decaf-crud-field", {
    label: "erpnext.couponCode.modified.label",
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
