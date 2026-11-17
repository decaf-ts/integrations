/**
 * @module integrations/tests/integration/erpnext/ERPNextLive
 * @summary Live integration coverage for the ERPNext adapter against a real
 * Frappe/ERPNext site.
 * @description Opt-in: set `DECAF_ERPNEXT_IT=1`, `ERPNEXT_URL` and
 * `ERPNEXT_TOKEN` (`api_key:api_secret`). Without `DECAF_ERPNEXT_IT=1` the whole
 * suite is skipped. See `docker/erpnext-compose.yml` and
 * `workdocs/services/erpnext-live-tests.md`.
 */
import { it } from "@decaf-ts/for-testing";
import { afterAll, beforeAll, describe, expect, jest } from "@jest/globals";
import { Condition, Context, OrderDirection } from "@decaf-ts/core";
import {
  ERPNextAuthenticationError,
  ERPNextCustomer,
  ERPNextJournalEntry,
  ERPNextJournalEntryAccount,
  ERPNextNotFoundError,
  ERPNextPaymentEntry,
  ERPNextPaymentRequest,
  ERPNextReport,
  ERPNextRepository,
  ERPNextSalesInvoice,
  ERPNextSalesInvoiceItem,
  ERPNextSubscription,
  ERPNextSubscriptionPlanDetail,
} from "../../../src/erpnext";
import { ERPNextClient } from "../../../src/erpnext";
import type { ERPNextAdapter } from "../../../src/erpnext";
import {
  createLiveAdapter,
  createLiveClient,
  ensureLiveFixtures,
  liveEnabled,
  liveBaseUrl,
  livePassword,
  liveUsername,
  type LiveFixtures,
} from "./live-helpers";

// A freshly created compose stack has no site setup: the first run walks the
// setup wizard and creates the fixtures, which takes far longer than Jest's 5s
// default (the documented `npm run test:integration` command must pass without
// a CLI `--testTimeout` override).
jest.setTimeout(600_000);

const run = liveEnabled ? describe : describe.skip;

const suffix = `${Date.now().toString(36)}${Math.random()
  .toString(36)
  .slice(2, 6)}`.toUpperCase();

let adapter: ERPNextAdapter;
let fixtures: LiveFixtures;

let customerRepo: ERPNextRepository<ERPNextCustomer>;
let invoiceRepo: ERPNextRepository<ERPNextSalesInvoice>;
let subscriptionRepo: ERPNextRepository<ERPNextSubscription>;
let paymentEntryRepo: ERPNextRepository<ERPNextPaymentEntry>;
let paymentRequestRepo: ERPNextRepository<ERPNextPaymentRequest>;
let journalEntryRepo: ERPNextRepository<ERPNextJournalEntry>;
let reportRepo: ERPNextRepository<ERPNextReport>;

const queryPrefix = `DECAF IT Query ${suffix}`;
const queryCustomer = `${queryPrefix} Z Account`;
const queryCustomers: ERPNextCustomer[] = [];
const queryInvoices: ERPNextSalesInvoice[] = [];
const querySubscriptions: ERPNextSubscription[] = [];

async function safeDelete(
  repo: ERPNextRepository<any>,
  name?: string
): Promise<void> {
  if (!name) return;
  try {
    await repo.delete(name);
  } catch {
    // best-effort cleanup; the stack itself is ephemeral
  }
}

run("ERPNext live integration", () => {
  beforeAll(async () => {
    const client = createLiveClient();
    await client.initialize();
    fixtures = await ensureLiveFixtures(client);

    adapter = createLiveAdapter();
    await adapter.initialize();

    customerRepo = new ERPNextRepository(adapter, ERPNextCustomer);
    invoiceRepo = new ERPNextRepository(adapter, ERPNextSalesInvoice);
    subscriptionRepo = new ERPNextRepository(adapter, ERPNextSubscription);
    paymentEntryRepo = new ERPNextRepository(adapter, ERPNextPaymentEntry);
    paymentRequestRepo = new ERPNextRepository(adapter, ERPNextPaymentRequest);
    journalEntryRepo = new ERPNextRepository(adapter, ERPNextJournalEntry);
    reportRepo = new ERPNextRepository(adapter, ERPNextReport);

    const queryTypes = ["Company", "Individual", "Company"];
    for (const [index, type] of queryTypes.entries()) {
      queryCustomers.push(
        await customerRepo.create(
          new ERPNextCustomer({
            customer_name: `${queryPrefix} ${String.fromCharCode(65 + index)}`,
            customer_type: type,
            customer_group: "Commercial",
            territory: "All Territories",
          })
        )
      );
    }

    queryCustomers.push(
      await customerRepo.create(
        new ERPNextCustomer({
          customer_name: queryCustomer,
          customer_type: "Company",
          customer_group: "Commercial",
          territory: "All Territories",
        })
      )
    );

    const invoiceSeed = [
      { rate: 100, posting_date: new Date("2026-11-01T00:00:00.000Z") },
      { rate: 200, posting_date: new Date("2026-11-02T00:00:00.000Z") },
      { rate: 300, posting_date: new Date("2026-11-03T00:00:00.000Z") },
    ];
    for (const seed of invoiceSeed) {
      queryInvoices.push(
        await invoiceRepo.create(
          new ERPNextSalesInvoice({
            customer: queryCustomer,
            company: fixtures.company,
            posting_date: seed.posting_date,
            currency: "USD",
            items: [
              new ERPNextSalesInvoiceItem({
                item_code: fixtures.item,
                qty: 1,
                rate: seed.rate,
              }),
            ],
          })
        )
      );
    }

    for (const day of ["2026-03-01", "2026-03-02", "2026-03-03"]) {
      querySubscriptions.push(
        await subscriptionRepo.create(
          new ERPNextSubscription({
            party_type: "Customer",
            party: queryCustomer,
            company: fixtures.company,
            generate_invoice_at: "Beginning of the current subscription period",
            start_date: new Date(`${day}T00:00:00.000Z`),
            plans: [
              new ERPNextSubscriptionPlanDetail({
                plan: fixtures.plan,
                qty: 1,
              }),
            ],
          })
        )
      );
    }
  });

  afterAll(async () => {
    for (const subscription of [...querySubscriptions].reverse())
      await safeDelete(subscriptionRepo, subscription?.name);
    for (const invoice of [...queryInvoices].reverse())
      await safeDelete(invoiceRepo, invoice?.name);
    for (const customer of [...queryCustomers].reverse())
      await safeDelete(customerRepo, customer?.name);
    await adapter?.shutdown();
  });

  describe("adapter initialization and authentication", () => {
    it("initializes with token authentication and reads the site", async () => {
      expect(adapter.client.initialized).toBeTruthy();
      const customers = await customerRepo.read(fixtures.customer);
      expect(customers).toBeInstanceOf(ERPNextCustomer);
      expect(customers.name).toBe(fixtures.customer);
    });

    it("falls back to a Frappe session login when no token is configured", async () => {
      // SAA-1688: the default `frappe-js-sdk` transport keeps the `sid` session
      // cookie, so the default client path exercises the session-login fallback
      // without any custom transport.
      const client = new ERPNextClient({
        baseUrl: liveBaseUrl,
        username: liveUsername,
        password: livePassword,
      });
      await client.initialize();
      expect(client.usesTokenAuth).toBeFalsy();
      const documents = await client.listDocs("Customer", {
        fields: ["name"],
        limitPageLength: 1,
      });
      expect(Array.isArray(documents)).toBe(true);
      expect(documents.length).toBeGreaterThan(0);
    });

    it("rejects invalid token credentials with the ERPNext auth error", async () => {
      const client = createLiveClient({
        apiKey: "invalid-key",
        apiSecret: "invalid-secret",
      });
      await expect(client.listDocs("Customer")).rejects.toBeInstanceOf(
        ERPNextAuthenticationError
      );
    });
  });

  describe("CRUD round-trip", () => {
    it("creates, reads, updates and deletes a document", async () => {
      const name = `DECAF IT Crud ${suffix}`;
      const created = await customerRepo.create(
        new ERPNextCustomer({
          customer_name: name,
          customer_type: "Company",
          customer_group: "Commercial",
          territory: "All Territories",
        })
      );
      expect(created).toBeInstanceOf(ERPNextCustomer);
      expect(created.name).toBeTruthy();
      expect(created.customer_name).toBe(name);
      expect(created.customer_type).toBe("Company");

      const read = await customerRepo.read(created.name);
      expect(read).toBeInstanceOf(ERPNextCustomer);
      expect(read.customer_name).toBe(name);
      expect(read.customer_type).toBe("Company");
      expect(typeof read.disabled).toBe("boolean");

      read.customer_name = `${name} Updated`;
      read.customer_type = "Individual";
      const updated = await customerRepo.update(read);
      expect(updated).toBeInstanceOf(ERPNextCustomer);
      expect(updated.customer_name).toBe(`${name} Updated`);
      expect(updated.customer_type).toBe("Individual");
      expect(typeof updated.disabled).toBe("boolean");

      const reread = await customerRepo.read(created.name);
      expect(reread.customer_name).toBe(`${name} Updated`);
      expect(reread.customer_type).toBe("Individual");
      expect(typeof reread.disabled).toBe("boolean");

      await customerRepo.delete(created.name);
      await expect(customerRepo.read(created.name)).rejects.toBeInstanceOf(
        ERPNextNotFoundError
      );
    });

    it("round-trips Date attributes and bigint serialization", async () => {
      const startDate = new Date("2026-03-04T00:00:00.000Z");
      const subscription = await subscriptionRepo.create(
        new ERPNextSubscription({
          party_type: "Customer",
          party: fixtures.customer,
          company: fixtures.company,
          generate_invoice_at: "Beginning of the current subscription period",
          start_date: startDate,
          plans: [
            new ERPNextSubscriptionPlanDetail({ plan: fixtures.plan, qty: 1 }),
          ],
        })
      );
      try {
        const read = await subscriptionRepo.read(subscription.name);
        expect(read).toBeInstanceOf(ERPNextSubscription);
        expect(read.start_date).toBeInstanceOf(Date);
        expect(
          (read.start_date as Date).toISOString().slice(0, 10)
        ).toBe("2026-03-04");

        const reportName = `DECAF IT Bigint ${suffix}`;
        const ctx = new Context();
        const created = await adapter.create(
          ERPNextReport,
          reportName,
          {
            report_name: reportName,
            ref_doctype: "Sales Invoice",
            is_standard: "No",
            report_type: "Report Builder",
            timeout: BigInt(42),
          } as never,
          ctx
        );
        try {
          const document = await adapter.read(ERPNextReport, created.name, ctx);
          expect(Number(document.timeout)).toBe(42);
        } finally {
          await safeDelete(reportRepo, created.name);
        }
      } finally {
        await safeDelete(subscriptionRepo, subscription.name);
      }
    });
  });

  describe("list and query", () => {
    it("select().execute() returns models", async () => {
      const results = await customerRepo.select().execute();
      expect(Array.isArray(results)).toBe(true);
      expect(results.length).toBeGreaterThanOrEqual(queryCustomers.length);
      expect(results[0]).toBeInstanceOf(ERPNextCustomer);
    });

    it("findBy works on a non-primary-key attribute", async () => {
      const results = await customerRepo.findBy(
        "customer_name",
        `${queryPrefix} B`
      );
      expect(results).toHaveLength(1);
      expect(results[0]).toBeInstanceOf(ERPNextCustomer);
      expect(results[0].name).toBeTruthy();
      expect(results[0].customer_name).toBe(`${queryPrefix} B`);
      expect(results[0].customer_type).toBe("Individual");
    });

    it("filters with a simple where and keeps non-PK attributes", async () => {
      const results = await customerRepo
        .select()
        .where(
          Condition.attribute<ERPNextCustomer>("customer_name").startsWith(
            queryPrefix
          )
        )
        .execute();
      expect(results).toHaveLength(queryCustomers.length);
      for (const customer of results) {
        expect(customer).toBeInstanceOf(ERPNextCustomer);
        expect(customer.name).toBeTruthy();
        expect(customer.customer_name.startsWith(queryPrefix)).toBe(true);
        expect(customer.customer_type).toBeTruthy();
      }
    });

    it("filters with an AND condition", async () => {
      const results = await customerRepo
        .select()
        .where(
          Condition.and(
            Condition.attribute<ERPNextCustomer>("customer_name").startsWith(
              queryPrefix
            ),
            Condition.attribute<ERPNextCustomer>("customer_type").eq("Company")
          )
        )
        .execute();
      expect(results).toHaveLength(3);
      for (const customer of results)
        expect(customer.customer_type).toBe("Company");
    });

    it("filters with an OR condition", async () => {
      const results = await customerRepo
        .select()
        .where(
          Condition.or(
            Condition.attribute<ERPNextCustomer>("customer_type").eq(
              "Individual"
            ),
            Condition.attribute<ERPNextCustomer>("customer_name").eq(
              `${queryPrefix} C`
            )
          )
        )
        .execute();
      const names = results.map((customer) => customer.name);
      expect(names).toEqual(
        expect.arrayContaining([`${queryPrefix} B`, `${queryPrefix} C`])
      );
    });

    it("orders, limits and offsets results", async () => {
      const results = await customerRepo
        .select()
        .where(
          Condition.attribute<ERPNextCustomer>("customer_name").startsWith(
            queryPrefix
          )
        )
        .orderBy(["customer_name", OrderDirection.ASC])
        .limit(2)
        .offset(1)
        .execute();
      expect(results.map((customer) => customer.name)).toEqual([
        `${queryPrefix} B`,
        `${queryPrefix} C`,
      ]);
    });

    it("paginates by a non-primary-key attribute", async () => {
      const page = await customerRepo.paginateBy(
        "name",
        OrderDirection.ASC,
        { offset: 1, limit: 2 }
      );
      expect(page.data.length).toBeLessThanOrEqual(2);
      expect(page.count).toBeGreaterThanOrEqual(queryCustomers.length);
      expect(page.total).toBeGreaterThanOrEqual(1);
      for (const customer of page.data)
        expect(customer).toBeInstanceOf(ERPNextCustomer);
    });
  });

  describe("aggregation, grouping and distinct through raw", () => {
    const ctx = new Context().accumulate({ rebuildWithTransient: false });
    const base = () => ({
      from: ERPNextSalesInvoice,
      filters: [["customer", "=", queryCustomer]] as [
        string,
        "=",
        string
      ][],
    });
    const aggregate = (query: Record<string, unknown>) =>
      adapter.raw(query as never, true, ctx);

    it("counts matching documents", async () => {
      expect(await aggregate({ ...base(), count: "name" })).toBe(3);
      expect(await aggregate({ ...base(), count: null })).toBe(3);
    });

    it("counts distinct values", async () => {
      expect(await aggregate({ ...base(), countDistinct: "customer" })).toBe(1);
    });

    it("computes min, max, sum and avg", async () => {
      expect(await aggregate({ ...base(), min: "grand_total" })).toBe(100);
      expect(await aggregate({ ...base(), max: "grand_total" })).toBe(300);
      expect(await aggregate({ ...base(), sum: "grand_total" })).toBe(600);
      expect(await aggregate({ ...base(), avg: "grand_total" })).toBe(200);
    });

    it("aggregates date attributes", async () => {
      const subscriptionBase = {
        from: ERPNextSubscription,
        filters: [["party", "=", queryCustomer]] as [string, "=", string][],
      };
      const min = await aggregate({
        ...subscriptionBase,
        min: "start_date",
      });
      expect(min).toBeInstanceOf(Date);
      expect((min as Date).toISOString().slice(0, 10)).toBe("2026-03-01");

      const max = await aggregate({
        ...subscriptionBase,
        max: "start_date",
      });
      expect(max).toBeInstanceOf(Date);
      expect((max as Date).toISOString().slice(0, 10)).toBe("2026-03-03");

      const average = await aggregate({
        ...subscriptionBase,
        avg: "start_date",
      });
      expect(average).toBeInstanceOf(Date);
    });

    it("returns distinct values", async () => {
      expect(await aggregate({ ...base(), distinct: "status" })).toEqual([
        "Draft",
      ]);
    });

    it("groups records and paginates groups", async () => {
      const grouped = (await aggregate({
        ...base(),
        groupBy: ["status"],
      })) as Record<string, unknown[]>;
      expect(Object.keys(grouped)).toEqual(["Draft"]);
      expect(grouped.Draft).toHaveLength(3);

      const paged = (await aggregate({
        ...base(),
        groupBy: ["status"],
        skip: 0,
        limit: 1,
      })) as Record<string, unknown[]>;
      expect(Object.keys(paged)).toHaveLength(1);
    });

    it("returns { data, count } when documents are not requested", async () => {
      const result = (await adapter.raw(
        { ...base() } as never,
        false as never,
        ctx
      )) as { data: unknown[]; count: number };
      expect(result.count).toBe(3);
      expect(result.data).toHaveLength(3);
    });
  });

  describe("doctype smoke: create/read/delete per area", () => {
    const today = new Date("2026-11-17T00:00:00.000Z");

    it("Subscription", async () => {
      const created = await subscriptionRepo.create(
        new ERPNextSubscription({
          party_type: "Customer",
          party: fixtures.customer,
          company: fixtures.company,
          generate_invoice_at: "Beginning of the current subscription period",
          start_date: today,
          plans: [
            new ERPNextSubscriptionPlanDetail({ plan: fixtures.plan, qty: 1 }),
          ],
        })
      );
      try {
        expect(created.name).toBeTruthy();
        expect(created.party).toBe(fixtures.customer);
        expect(created.start_date).toBeInstanceOf(Date);
        const read = await subscriptionRepo.read(created.name);
        expect(read.party).toBe(fixtures.customer);
      } finally {
        await safeDelete(subscriptionRepo, created.name);
      }
    });

    it("Payment Entry", async () => {
      const created = await paymentEntryRepo.create(
        new ERPNextPaymentEntry({
          payment_type: "Receive",
          posting_date: today,
          company: fixtures.company,
          party_type: "Customer",
          party: fixtures.customer,
          paid_from: fixtures.receivableAccount,
          paid_from_account_currency: "USD",
          paid_to: fixtures.cashAccount,
          paid_to_account_currency: "USD",
          source_exchange_rate: 1,
          target_exchange_rate: 1,
          received_amount: 100,
          paid_amount: 100,
          base_paid_amount: 100,
          base_received_amount: 100,
        })
      );
      try {
        expect(created.name).toBeTruthy();
        expect(created.payment_type).toBe("Receive");
        const read = await paymentEntryRepo.read(created.name);
        expect(read.paid_amount).toBe(100);
      } finally {
        await safeDelete(paymentEntryRepo, created.name);
      }
    });

    it("Payment Request", async () => {
      const invoice = await invoiceRepo.create(
        new ERPNextSalesInvoice({
          customer: fixtures.customer,
          company: fixtures.company,
          posting_date: today,
          currency: "USD",
          items: [
            new ERPNextSalesInvoiceItem({
              item_code: fixtures.item,
              qty: 1,
              rate: 100,
            }),
          ],
        })
      );
      let request: ERPNextPaymentRequest | undefined;
      try {
        request = await paymentRequestRepo.create(
          new ERPNextPaymentRequest({
            payment_request_type: "Inward",
            transaction_date: today,
            company: fixtures.company,
            party_type: "Customer",
            party: fixtures.customer,
            grand_total: 100,
            currency: "USD",
            reference_doctype: "Sales Invoice",
            reference_name: invoice.name,
          })
        );
        expect(request.name).toBeTruthy();
        expect(request.reference_name).toBe(invoice.name);
        const read = await paymentRequestRepo.read(request.name);
        expect(read.grand_total).toBe(100);
      } finally {
        await safeDelete(paymentRequestRepo, request?.name);
        await safeDelete(invoiceRepo, invoice?.name);
      }
    });

    it("Sales Invoice", async () => {
      const created = await invoiceRepo.create(
        new ERPNextSalesInvoice({
          customer: fixtures.customer,
          company: fixtures.company,
          posting_date: today,
          currency: "USD",
          items: [
            new ERPNextSalesInvoiceItem({
              item_code: fixtures.item,
              qty: 2,
              rate: 50,
            }),
          ],
        })
      );
      try {
        expect(created.name).toBeTruthy();
        expect(created.customer).toBe(fixtures.customer);
        expect(created.grand_total).toBe(100);
        const read = await invoiceRepo.read(created.name);
        expect(read.posting_date).toBeInstanceOf(Date);
        expect(read.grand_total).toBe(100);
      } finally {
        await safeDelete(invoiceRepo, created.name);
      }
    });

    it("Journal Entry", async () => {
      const created = await journalEntryRepo.create(
        new ERPNextJournalEntry({
          voucher_type: "Journal Entry",
          company: fixtures.company,
          posting_date: today,
          accounts: [
            new ERPNextJournalEntryAccount({
              account: fixtures.cashAccount,
              debit_in_account_currency: 50,
            }),
            new ERPNextJournalEntryAccount({
              account: fixtures.receivableAccount,
              credit_in_account_currency: 50,
              party_type: "Customer",
              party: fixtures.customer,
            }),
          ],
        })
      );
      try {
        expect(created.name).toBeTruthy();
        expect(created.voucher_type).toBe("Journal Entry");
        const read = await journalEntryRepo.read(created.name);
        expect(read.posting_date).toBeInstanceOf(Date);
        expect(read.total_debit).toBe(50);
      } finally {
        await safeDelete(journalEntryRepo, created.name);
      }
    });

    it("Report", async () => {
      const reportName = `DECAF IT Report ${suffix}`;
      const created = await reportRepo.create(
        new ERPNextReport({
          report_name: reportName,
          ref_doctype: "Sales Invoice",
          is_standard: "No",
          report_type: "Report Builder",
        })
      );
      try {
        expect(created.name).toBeTruthy();
        expect(created.report_name).toBe(reportName);
        const read = await reportRepo.read(created.name);
        expect(read.ref_doctype).toBe("Sales Invoice");
      } finally {
        await safeDelete(reportRepo, created.name);
      }
    });
  });
});
