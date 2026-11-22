/**
 * Credit storage (`spec/billing.md` §3.5, §4.4).
 *
 * Split from `pg/billing-money.mjs` for the file-size ratchet. A credit is a signed row in
 * `org_credit_ledger`; the balance is its sum, and spending it locks the organisation so
 * two checkouts cannot both spend the same money.
 */
import { assertMinorUnits, assertSignedMinorUnits } from "../billing-money.mjs";
import { LEDGER_KINDS, codedError, mapAmount, normalCurrency } from "./billing-money.mjs";

export const billingCreditMethods = {
  /** A positive journal row: proration, goodwill or a refund moved into credit. */
  async appendCredit({
    orgId,
    amount,
    currency,
    kind,
    invoiceId = null,
    note = null,
    createdBy = null,
  }) {
    const value = assertSignedMinorUnits(amount, "amount");
    const code = normalCurrency(currency);
    if (!LEDGER_KINDS.has(kind)) throw new RangeError("unknown credit kind");
    if (kind === "applied" ? value > 0 : value < 0) {
      throw new RangeError("applied credit must be negative and every other kind positive");
    }
    if (invoiceId) {
      const { rows } = await this.pool.query(
        "select id from invoices where org_id = $1 and id = $2",
        [orgId, invoiceId],
      );
      if (!rows[0]) throw codedError("INVOICE_NOT_FOUND", "invoice does not exist");
    }

    const { rows } = await this.pool.query(
      `insert into org_credit_ledger
         (org_id, amount, currency, kind, invoice_id, note, created_by)
       values ($1, $2, $3, $4, $5, $6, $7)
       returning *`,
      [orgId, value, code, kind, invoiceId, note, createdBy],
    );
    return mapAmount(rows[0]);
  },

  /** The balance is the journal sum; there is no stored counter to drift. */
  async creditBalance(orgId, currency) {
    const code = normalCurrency(currency);
    const { rows } = await this.pool.query(
      `select coalesce(sum(amount), 0)::text as balance
         from org_credit_ledger
        where org_id = $1 and currency = $2`,
      [orgId, code],
    );
    const balance = Number(rows[0]?.balance ?? 0);
    if (!Number.isSafeInteger(balance)) {
      throw new RangeError("credit balance is outside the safe integer range");
    }
    return balance;
  },

  /**
   * Spend credit on an invoice. The lock serialises two checkouts of the same balance,
   * and the journal is written only after the balance proves sufficient, so a race can
   * never produce a negative balance.
   */
  async applyCredit({ orgId, currency, amount, invoiceId }) {
    const value = assertMinorUnits(amount, "amount");
    const code = normalCurrency(currency);
    if (value <= 0) throw new RangeError("credit to apply must be positive");

    const client = await this.pool.connect();
    try {
      await client.query("begin");
      await client.query("select pg_advisory_xact_lock(hashtext($1))", [
        `billing_credit:${orgId}:${code}`,
      ]);

      const { rows: balances } = await client.query(
        `select coalesce(sum(amount), 0)::text as balance
           from org_credit_ledger
          where org_id = $1 and currency = $2`,
        [orgId, code],
      );
      const balance = Number(balances[0]?.balance ?? 0);
      if (!Number.isSafeInteger(balance) || balance < value) {
        throw codedError("INSUFFICIENT_CREDIT", "credit balance is too small");
      }

      const { rows: invoices } = await client.query(
        "select id, currency from invoices where org_id = $1 and id = $2",
        [orgId, invoiceId],
      );
      if (!invoices[0]) throw codedError("INVOICE_NOT_FOUND", "invoice does not exist");
      if (invoices[0].currency !== code) {
        throw codedError("CURRENCY_MISMATCH", "credit currency does not match the invoice");
      }

      const { rows } = await client.query(
        `insert into org_credit_ledger
           (org_id, amount, currency, kind, invoice_id, note)
         values ($1, $2, $3, 'applied', $4, $5)
         returning *`,
        [orgId, -value, code, invoiceId, "applied at checkout"],
      );
      await client.query("commit");
      return mapAmount(rows[0]);
    } catch (error) {
      await client.query("rollback").catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  },
};
