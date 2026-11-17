/**
 * @module integrations/tests/integration/erpnext/live-helpers
 * @summary Shared helpers for the opt-in live ERPNext integration suite.
 * @description The live suite runs against a real Frappe/ERPNext site (see
 * `docker/erpnext-compose.yml`). It is opt-in through `DECAF_ERPNEXT_IT=1` and
 * reads `ERPNEXT_URL` + `ERPNEXT_TOKEN` (`api_key:api_secret`); without those it
 * is skipped entirely. These helpers bring an empty site to the minimal state the
 * adapter needs (site setup, a company, a fiscal year, a customer, an item, a
 * subscription plan) so the tests themselves only exercise the adapter.
 */
import { ERPNextAdapter, ERPNextClient } from "../../../src/erpnext";
import type { ERPNextConfig, ERPNextFilter } from "../../../src/erpnext";

export const liveEnabled = process.env.DECAF_ERPNEXT_IT === "1";

export const liveBaseUrl = (
  process.env.ERPNEXT_URL ?? "http://localhost:8181"
).replace(/\/+$/, "");

export const liveUsername = process.env.ERPNEXT_USERNAME ?? "Administrator";

export const livePassword = process.env.ERPNEXT_PASSWORD ?? "admin123";

export interface LiveCredentials {
  apiKey: string;
  apiSecret: string;
}

/**
 * Splits the `ERPNEXT_TOKEN` value into its key/secret pair.
 * @throws {Error} When the token is missing or not in `key:secret` form
 */
export function liveCredentials(): LiveCredentials {
  const token = process.env.ERPNEXT_TOKEN ?? "";
  const separator = token.indexOf(":");
  if (separator <= 0 || separator === token.length - 1)
    throw new Error(
      "ERPNEXT_TOKEN must be set to 'api_key:api_secret' when DECAF_ERPNEXT_IT=1"
    );
  return {
    apiKey: token.slice(0, separator),
    apiSecret: token.slice(separator + 1),
  };
}

export function liveConfig(overrides: Partial<ERPNextConfig> = {}): ERPNextConfig {
  const { apiKey, apiSecret } = liveCredentials();
  return {
    baseUrl: liveBaseUrl,
    apiKey,
    apiSecret,
    timeout: 60000,
    ...overrides,
  };
}

export function createLiveClient(
  overrides: Partial<ERPNextConfig> = {}
): ERPNextClient {
  return new ERPNextClient(liveConfig(overrides));
}

export function createLiveAdapter(
  overrides: Partial<ERPNextConfig> = {}
): ERPNextAdapter {
  return new ERPNextAdapter(liveConfig(overrides));
}

export interface LiveSite {
  company: string;
  abbr: string;
  fiscalYear: string;
  cashAccount: string;
  receivableAccount: string;
}

export interface LiveFixtures extends LiveSite {
  priceList: string;
  customer: string;
  item: string;
  plan: string;
}

async function listAll(
  client: ERPNextClient,
  doctype: string,
  filters: ERPNextFilter[] = [],
  fields: string[] = ["name"]
): Promise<Record<string, any>[]> {
  return client.listDocs(doctype, {
    filters,
    fields,
    limitPageLength: 0,
  });
}

/**
 * Ensures the site has a company + fiscal year. A raw `bench new-site` produces
 * an ERPNext site without the setup wizard, so no company, warehouse type, UOM,
 * customer group and price list exist yet; the adapter (and every accounting
 * doctype) needs them. On an empty site this runs the standard setup wizard once
 * through the public API; on an already-configured site it reuses the company.
 * @param client authenticated ERPNext client
 * @return the resolved site fixtures
 */
export async function ensureLiveSite(
  client: ERPNextClient
): Promise<LiveSite> {
  let companies = await listAll(client, "Company", [], ["name", "abbr"]);
  if (!companies.length) {
    await client.callMethod(
      "frappe.desk.page.setup_wizard.setup_wizard.initialize_system_settings_and_user",
      {
        system_settings_data: {
          language: "en",
          country: "United States",
          currency: "USD",
          time_zone: "UTC",
        },
        user_data: {},
      }
    );
    await client.callMethod(
      "frappe.desk.page.setup_wizard.setup_wizard.setup_complete",
      {
        args: {
          company_name: "Decaf IT Co",
          company_abbr: "DITC",
          country: "United States",
          currency: "USD",
          timezone: "UTC",
          language: "English",
          fy_start_date: `${new Date().getUTCFullYear()}-01-01`,
          fy_end_date: `${new Date().getUTCFullYear()}-12-31`,
          chart_of_accounts: "Standard",
          domain: "Distribution",
        },
      }
    );
    companies = await listAll(client, "Company", [], ["name", "abbr"]);
  }

  if (!companies.length)
    throw new Error("ERPNext live site has no company after setup");

  const company = companies[0] as { name: string; abbr: string };
  const abbr = company.abbr ?? company.name;

  const accounts = await listAll(
    client,
    "Account",
    [
      ["company", "=", company.name],
      ["is_group", "=", 0],
    ],
    ["name", "account_type"]
  );

  const findAccount = (type: string, fallbackName: string): string => {
    const match = accounts.find(
      (account) => account.account_type === type
    ) as { name: string } | undefined;
    return match?.name ?? fallbackName;
  };

  const cashAccount =
    findAccount("Cash", "") || findAccount("Bank", "") ||
    `Cash - ${abbr}`;
  const receivableAccount = findAccount(
    "Receivable",
    `Debtors - ${abbr}`
  );

  const fiscalYears = await listAll(
    client,
    "Fiscal Year",
    [],
    ["name"]
  );

  return {
    company: company.name,
    abbr,
    fiscalYear: (fiscalYears[0] as { name: string } | undefined)?.name ?? "",
    cashAccount,
    receivableAccount,
  };
}

async function ensureRecord(
  client: ERPNextClient,
  doctype: string,
  filters: ERPNextFilter[],
  payload: Record<string, any>,
  key: string
): Promise<string> {
  const found = await listAll(client, doctype, filters, [key]);
  if (found.length) return String(found[0][key] ?? found[0].name);
  const created = await client.createDoc(doctype, payload);
  return String(created?.[key] ?? created?.name);
}

/**
 * Creates (or reuses) the fixture documents the adapter live tests need.
 * @param client authenticated ERPNext client
 * @return the resolved fixture values
 */
export async function ensureLiveFixtures(
  client: ERPNextClient
): Promise<LiveFixtures> {
  const site = await ensureLiveSite(client);

  const priceList = await ensureRecord(
    client,
    "Price List",
    [["name", "=", "Standard Selling"]],
    {
      price_list_name: "Standard Selling",
      currency: "USD",
      selling: 1,
      buying: 0,
      enabled: 1,
    },
    "name"
  );

  const customer = await ensureRecord(
    client,
    "Customer",
    [["customer_name", "=", "DECAF IT Customer"]],
    {
      customer_name: "DECAF IT Customer",
      customer_group: "Commercial",
      territory: "All Territories",
      default_price_list: priceList,
    },
    "name"
  );

  const item = await ensureRecord(
    client,
    "Item",
    [["name", "=", "DECAF-IT-ITEM"]],
    {
      item_code: "DECAF-IT-ITEM",
      item_name: "DECAF IT Item",
      item_group: "Services",
      stock_uom: "Nos",
      is_sales_item: 1,
      is_purchase_item: 1,
      is_stock_item: 0,
    },
    "name"
  );

  const plan = await ensureRecord(
    client,
    "Subscription Plan",
    [["name", "=", "Decaf IT Plan"]],
    {
      plan_name: "Decaf IT Plan",
      currency: "USD",
      item,
      price_determination: "Fixed Rate",
      cost: 10,
      billing_interval: "Month",
      billing_interval_count: 1,
    },
    "name"
  );

  return { ...site, priceList, customer, item, plan };
}
