/** Metadata for the home feed. Contents are matched inside Postgres and never selected. */
export async function homeCandidates(pool, { orgId, user, liveIds, cached }) {
  const { rows } = await pool.query(
    `with rooms as (
       select b.id, b.title, b.owner_id from boards b
       where b.org_id=$2 and b.archived_at is null and b.owner_id is not null
     ), events as (
       select distinct on (c.board_id) 'mention' as type, c.id::text as id,
              c.thread_id::text as target, c.board_id, c.created_at as at, c.author_name as name
         from comments c join rooms b on b.id=c.board_id
         join comment_threads t on t.id=c.thread_id and t.resolved_at is null
         left join comment_reads r on r.thread_id=t.id and r.subject_id='user:'||$1::uuid::text
        where c.created_at >= now()-interval '48 hours' and c.deleted_at is null
          and c.author_id <> $1::uuid and (r.last_read_at is null or c.created_at>r.last_read_at)
          and ($5::uuid[] is null or c.id=any($5))
          and (t.created_by=$1::uuid or ($3::text is not null and exists (select 1 from regexp_matches(lower(c.body),
               '(?:^|[^a-z0-9_.@-])@([a-z0-9](?:[a-z0-9._-]*[a-z0-9])?)', 'g') h where h[1]=$3)))
        order by c.board_id,c.created_at desc,c.id
     ), proposals as (
       select distinct on (a.board_id) 'agent' as type, a.id::text, a.id::text as target,
              a.board_id, coalesce(a.finished_at,a.created_at) as at, null::text as name
       from agent_tasks a join rooms b on b.id=a.board_id
       where a.status='awaiting_approval' and (a.created_by=$1::uuid or b.owner_id=$1::uuid)
         and coalesce(a.finished_at,a.created_at)>=now()-interval '48 hours'
         and ($6::uuid[] is null or a.id=any($6))
       order by a.board_id, at desc, a.id
     ), arrivals as (
       select 'joined' as type,i.id::text,null::text as target,null::text as board_id,
              i.accepted_at as at,u.name
       from invitations i join users u on u.id=i.accepted_by and u.state='active'
       join org_memberships m on m.org_id=i.org_id and m.user_id=i.accepted_by and m.state='active'
       where i.org_id=$2 and i.target_type='org' and i.state='accepted'
         and i.accepted_by<>$1::uuid and i.accepted_at>=now()-interval '48 hours'
         and ($7::uuid[] is null or i.id=any($7))
     ), candidates as (
       select * from events union all select * from proposals union all select * from arrivals
       union all select 'live',b.id,null,b.id,now(),null from rooms b where b.id=any($4::text[])
     )
     select c.*,b.title, (b.owner_id=$1::uuid or exists (
        select 1 from comments own where own.board_id=b.id and own.author_id=$1::uuid
          and own.created_at>=now()-interval '7 days') or exists (
        select 1 from comment_reads r join comment_threads t on t.id=r.thread_id
         where t.board_id=b.id and r.subject_id='user:'||$1::uuid::text
           and r.last_read_at>=now()-interval '7 days') or exists (
        select 1 from event_outbox e where e.board_id=b.id and e.actor_id=$1::uuid::text
          and e.actor_type='user' and e.occurred_at>=now()-interval '7 days')
     ) as involved from candidates c left join rooms b on b.id=c.board_id`,
    [user.id, orgId, user.handle || null, liveIds, cached?.mention ?? null,
      cached?.agent ?? null, cached?.joined ?? null],
  );
  return rows;
}
