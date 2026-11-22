/**
 * The console's action idempotency (`spec/operator-actions.md` §3.3, ADR-262).
 *
 * A form sends a uuid; the first call claims a row in `operator_requests`, the action runs
 * once, and the answer is stored. A repeat with the same uuid returns that answer, while
 * the same uuid from another operator or for another route is refused. A failed action
 * releases its claim, so correcting the form and pressing again is possible.
 *
 * A claim is a row whose `result` is `{"state":"running"}`. Two browser tabs can send the
 * same form at once: the second sees the running row and waits for the first answer
 * instead of moving money twice.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const OPERATOR_REQUEST_RETENTION_DAYS = 30;

function codedError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

export const operatorRequestMethods = {
  /**
   * Try to own one form submission.
   *
   * @returns {Promise<{state: "new"|"done"|"busy"|"conflict", result?: unknown}>}
   * @throws when the id is not a uuid: an idempotency key that cannot be stored is a bug
   */
  async claimOperatorRequest({ requestId, operatorId, route }) {
    const id = String(requestId ?? "").trim();
    if (!UUID.test(id)) throw codedError("BAD_REQUEST_ID", "requestId must be a uuid");
    return this.withOwnerClient(async (client) => {
      const { rows: [inserted] } = await client.query(
        `insert into operator_requests (request_id, operator_id, route, result)
         values ($1, $2, $3, '{"state":"running"}'::jsonb)
         on conflict (request_id) do nothing
         returning request_id`,
        [id, operatorId, route],
      );
      if (inserted) return { state: "new" };
      const { rows: [row] } = await client.query(
        "select request_id, operator_id, route, result from operator_requests where request_id = $1",
        [id],
      );
      if (!row) return { state: "new" };
      if (row.operator_id !== operatorId || row.route !== route) {
        return { state: "conflict" };
      }
      if (row.result?.state === "running") return { state: "busy" };
      return { state: "done", result: row.result };
    });
  },

  /** Store the answer of a successful action; the row lives for 30 days. */
  async completeOperatorRequest({ requestId, result }) {
    await this.pool.query(
      "update operator_requests set result = $2::jsonb where request_id = $1",
      [requestId, JSON.stringify(result)],
    );
  },

  /** A failed action has no answer worth repeating: release the claim for a retry. */
  async releaseOperatorRequest({ requestId }) {
    await this.pool.query(
      `delete from operator_requests
        where request_id = $1 and result->>'state' = 'running'`,
      [requestId],
    );
  },

  /** The hourly pass removes rows past the retention window, bounded like the others. */
  async purgeOperatorRequests({ cutoff }) {
    const { rowCount } = await this.pool.query(
      `delete from operator_requests
        where request_id in (
          select request_id from operator_requests
           where created_at < $1
           order by created_at
           limit 1000
        )`,
      [cutoff],
    );
    return rowCount;
  },
};
