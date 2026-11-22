import { describe, expect, it } from "vitest";
import { MARK_PAID_USAGE, parseMarkPaidArgs, runMarkPaid } from "./billing-mark-paid.mjs";

/**
 * `billing:mark-paid` names its author (ADR-259 amendment). The happy path through the
 * ledger belongs to the database suite; here the command line and the two refusals that
 * happen before any money moves are covered.
 */
const INVOICE = "2f1a6c3e-5b7d-4c8a-9e0f-1a2b3c4d5e6f";
const OPERATOR = "11111111-1111-4111-8111-111111111111";

function capture() {
  const lines = [];
  return { lines, out: (line) => lines.push(String(line)), err: (line) => lines.push(String(line)) };
}

function fakeStore({ status = "open", operator = true } = {}) {
  const calls = [];
  return {
    calls,
    async connect() {},
    async findUserById(id) {
      return id === OPERATOR ? { id: OPERATOR, email: "ops@example.test" } : null;
    },
    async isInstanceOperator(id) {
      calls.push(["operator", id]);
      return operator && id === OPERATOR;
    },
    async listInstanceOperators() {
      return [{ userId: OPERATOR }];
    },
    async billingInvoiceGlobal(id) {
      calls.push(["invoice", id]);
      return {
        id,
        org_id: "99999999-9999-4999-8999-999999999999",
        number: "RU-1",
        status,
        currency: "RUB",
        total: 29000,
        lines: [],
      };
    },
    async withTenant(_org, fn) {
      return fn();
    },
    async recordAudit(event) {
      calls.push(["audit", event]);
    },
  };
}

describe("billing:mark-paid command line", () => {
  it("reads the invoice, the reason, the reference and the author", () => {
    expect(
      parseMarkPaidArgs([INVOICE, "--reason", "bank transfer", "--ref", "T-1", "--as", OPERATOR]),
    ).toEqual({
      help: false,
      invoiceId: INVOICE,
      reason: "bank transfer",
      ref: "T-1",
      as: OPERATOR,
      code: null,
    });
  });

  it("requires a reason and an author before anything is read", () => {
    expect(() => parseMarkPaidArgs([INVOICE, "--as", OPERATOR])).toThrow(/--reason/);
    expect(() => parseMarkPaidArgs(["--reason", "x"])).toThrow(/the invoice id/);
    expect(MARK_PAID_USAGE).toContain("--as");
  });

  it("refuses a payment without an author", async () => {
    const log = capture();
    const store = fakeStore();
    const code = await runMarkPaid({
      argv: [INVOICE, "--reason", "bank transfer"],
      env: {},
      store,
      out: log.out,
      err: log.err,
    });
    expect(code).toBe(1);
    expect(log.lines.join("\n")).toContain("--as");
    expect(store.calls).toEqual([]);
  });

  it("refuses an author who does not hold the role", async () => {
    const log = capture();
    const store = fakeStore({ operator: false });
    const code = await runMarkPaid({
      argv: [INVOICE, "--reason", "bank transfer", "--as", OPERATOR],
      env: {},
      store,
      out: log.out,
      err: log.err,
    });
    expect(code).toBe(1);
    expect(log.lines.join("\n")).toContain("is not an instance operator");
    expect(store.calls.some(([name]) => name === "invoice")).toBe(false);
  });

  it("reports an already paid invoice without writing a second row", async () => {
    const log = capture();
    const store = fakeStore({ status: "paid" });
    const code = await runMarkPaid({
      argv: [INVOICE, "--reason", "bank transfer", "--as", OPERATOR],
      store,
      env: {},
      out: log.out,
      err: log.err,
    });
    expect(code).toBe(0);
    expect(log.lines.join("\n")).toContain("already paid");
    expect(store.calls.some(([name]) => name === "audit")).toBe(false);
  });

  it("refuses a void invoice", async () => {
    const log = capture();
    const store = fakeStore({ status: "void" });
    const code = await runMarkPaid({
      argv: [INVOICE, "--reason", "bank transfer", "--as", OPERATOR],
      store,
      env: {},
      out: log.out,
      err: log.err,
    });
    expect(code).toBe(1);
    expect(log.lines.join("\n")).toContain("is void");
  });
});
