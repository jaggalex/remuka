import { randomUUID } from "node:crypto";

const due = `owner_id is not null and archived_at is null and cover_next_at <= now()
             and (cover_source_at is null or cover_source_at < cover_dirty_at)`;

export const coverMethods = {
  async roomCover(boardId) {
    const { rows } = await this.pool.query("select cover_data from boards where id = $1", [boardId]);
    return rows[0]?.cover_data ?? null;
  },
  /** Like filesForCollection: global discovery sees only IDs, rendering runs under tenant RLS. */
  async dueRoomCovers(limit) {
    return this.withOwnerClient(async (client) => {
      const result = await client.query(
        `select id, org_id from boards where ${due} order by cover_next_at, id limit $1`, [limit]);
      return result.rows;
    });
  },
  async claimRoomCover(id) {
    const token = randomUUID();
    const result = await this.pool.query(
      `update boards set cover_claim = $2, cover_next_at = clock_timestamp() + interval '10 minutes'
        where id = $1 and ${due} returning cover_dirty_at::text as source, cover_claim as token`,
      [id, token]);
    return result.rows[0] ?? null;
  },
  async publishRoomCover(id, claim, bytes) {
    const result = await this.pool.query(
      `update boards set cover_data = $4, cover_source_at = $3, cover_claim = null
        where id = $1 and cover_claim = $2 and archived_at is null`,
      [id, claim.token, claim.source, bytes]);
    return result.rowCount === 1;
  },
};
