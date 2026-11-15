alter table public.campaign_recipients
  drop constraint if exists campaign_recipients_status_check;

alter table public.campaign_recipients
  add constraint campaign_recipients_status_check
  check (status in (
    'queued',
    'sending',
    'sent',
    'delivered',
    'read',
    'failed',
    'skipped',
    'canceled'
  ));

alter table public.campaign_recipients
  add column if not exists attempt_count smallint not null default 0
    check (attempt_count between 0 and 1),
  add column if not exists attempt_token uuid,
  add column if not exists attempt_started_at timestamptz;

create index if not exists campaign_recipients_user_sent_at_idx
  on public.campaign_recipients (user_id, sent_at)
  where sent_at is not null;
create index if not exists campaign_recipients_user_delivered_at_idx
  on public.campaign_recipients (user_id, delivered_at)
  where delivered_at is not null;
create index if not exists campaign_recipients_user_read_at_idx
  on public.campaign_recipients (user_id, read_at)
  where read_at is not null;
create index if not exists campaign_recipients_user_failed_at_idx
  on public.campaign_recipients (user_id, failed_at)
  where failed_at is not null;
create index if not exists campaign_recipients_user_queued_at_idx
  on public.campaign_recipients (user_id, queued_at)
  where status = 'queued';

create table if not exists public.campaign_worker_lock (
  singleton boolean primary key default true check (singleton),
  lock_token uuid,
  locked_until timestamptz,
  next_available_at timestamptz
);
alter table public.campaign_worker_lock
  add column if not exists next_available_at timestamptz;

insert into public.campaign_worker_lock (singleton)
values (true)
on conflict (singleton) do nothing;

revoke all on public.campaign_worker_lock from public, anon, authenticated;
grant select, insert, update on public.campaign_worker_lock to service_role;

create or replace function public.claim_campaign_recipient()
returns table (
  outcome text,
  recipient_id uuid,
  attempt_token uuid,
  campaign_id uuid,
  user_id uuid,
  provider_instance_name text,
  phone_number text,
  message_body text,
  media_storage_path text,
  media_content_type text,
  media_file_name text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_lock_token uuid := gen_random_uuid();
  v_job record;
  v_plan_messages_limit bigint;
  v_unlimited_messages boolean;
  v_messages_sent bigint;
  v_attempt_token uuid;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'service_role_required';
  end if;

  perform 1
  from public.campaign_worker_lock as l
  where l.singleton
  for update;

  update public.campaign_worker_lock
  set
    lock_token = v_lock_token,
    locked_until = now() + interval '2 minutes'
  where singleton
    and (locked_until is null or locked_until <= now())
    and (next_available_at is null or next_available_at <= now());

  if not found then
    return;
  end if;

  update public.campaign_recipients as r
  set
    status = 'failed',
    failed_at = now(),
    error_code = 'delivery_outcome_unknown',
    error_message = 'Worker interrompido durante uma tentativa; resultado externo desconhecido.',
    attempt_token = null,
    attempt_started_at = null
  where r.status = 'sending'
    and r.attempt_started_at < now() - interval '10 minutes';

  insert into public.message_logs (
    user_id,
    campaign_id,
    recipient_id,
    status,
    error_code,
    error_message,
    event_at
  )
  select
    r.user_id,
    r.campaign_id,
    r.id,
    'failed',
    r.error_code,
    r.error_message,
    r.failed_at
  from public.campaign_recipients as r
  where r.status = 'failed'
    and r.error_code = 'delivery_outcome_unknown'
    and r.failed_at >= now() - interval '1 second'
    and not exists (
      select 1
      from public.message_logs as ml
      where ml.recipient_id = r.id
        and ml.error_code = 'delivery_outcome_unknown'
    );

  update public.campaigns as c
  set
    status = 'completed',
    completed_at = now()
  where c.status = 'running'
    and not exists (
      select 1
      from public.campaign_recipients as r
      where r.campaign_id = c.id
        and r.user_id = c.user_id
        and r.status in ('queued', 'sending')
    );

  loop
    select
      c.id as campaign_id,
      c.user_id,
      c.connection_id,
      c.message_body,
      r.id as recipient_id,
      r.phone_snapshot,
      r.attempt_count,
      coalesce(
        ct.consent_status = 'opted_in'
        and ct.consented_at is not null
        and ct.opted_out_at is null
        and ct.phone = r.phone_snapshot,
        false
      ) as consent_valid,
      wc.provider_instance_name,
      wc.status as connection_status,
      mf.storage_path as media_storage_path,
      mf.content_type as media_content_type,
      mf.file_name as media_file_name
    into v_job
    from public.campaigns as c
    join public.campaign_recipients as r
      on r.campaign_id = c.id
      and r.user_id = c.user_id
    left join public.contacts as ct
      on ct.id = r.contact_id
      and ct.user_id = r.user_id
    left join public.whatsapp_connections as wc
      on wc.id = c.connection_id
      and wc.user_id = c.user_id
    left join public.media_files as mf
      on mf.id = c.media_file_id
      and mf.user_id = c.user_id
    where c.status in ('scheduled', 'queued', 'running')
      and coalesce(c.scheduled_at, c.created_at) <= now()
      and r.status = 'queued'
    order by coalesce(c.scheduled_at, c.created_at), r.queued_at
    limit 1
    for update of c, r skip locked;

    if not found then
      update public.campaign_worker_lock
      set lock_token = null, locked_until = null
      where singleton and lock_token = v_lock_token;
      return;
    end if;

    if not exists (
      select 1
      from public.profiles as p
      where p.id = v_job.user_id
        and p.is_active
    ) then
      update public.campaigns
      set status = 'paused'
      where id = v_job.campaign_id and user_id = v_job.user_id;
      continue;
    end if;

    if v_job.connection_id is null
      or v_job.connection_status <> 'connected'
      or v_job.provider_instance_name is null
    then
      update public.campaigns
      set status = 'paused'
      where id = v_job.campaign_id and user_id = v_job.user_id;
      continue;
    end if;

    select p.messages_limit, p.unlimited_messages
      into v_plan_messages_limit, v_unlimited_messages
    from public.subscriptions as s
    join public.plans as p on p.id = s.plan_id
    where s.user_id = v_job.user_id
      and s.status in ('active', 'trialing', 'past_due')
      and s.starts_at <= now()
      and (s.ends_at is null or s.ends_at > now())
      and p.is_active
    order by s.starts_at desc
    limit 1;

    if not found then
      update public.campaigns
      set status = 'paused'
      where id = v_job.campaign_id and user_id = v_job.user_id;
      continue;
    end if;

    if not v_unlimited_messages then
      select count(*)
        into v_messages_sent
      from public.campaign_recipients as r
      where r.user_id = v_job.user_id
        and r.status in ('sent', 'delivered', 'read')
        and r.sent_at >= date_trunc('month', now());

      if v_messages_sent >= v_plan_messages_limit then
        update public.campaigns
        set status = 'paused'
        where id = v_job.campaign_id and user_id = v_job.user_id;
        continue;
      end if;
    end if;

    if not v_job.consent_valid then
      update public.campaign_recipients
      set
        status = 'skipped',
        error_code = 'consent_invalid',
        error_message = 'Contato sem consentimento ativo no momento do processamento.'
      where id = v_job.recipient_id
        and user_id = v_job.user_id
        and status = 'queued';

      insert into public.message_logs (
        user_id,
        campaign_id,
        recipient_id,
        status,
        error_code,
        error_message,
        event_at
      )
      values (
        v_job.user_id,
        v_job.campaign_id,
        v_job.recipient_id,
        'skipped',
        'consent_invalid',
        'Contato sem consentimento ativo no momento do processamento.',
        now()
      );

      return query
      select
        'skipped'::text,
        v_job.recipient_id,
        null::uuid,
        v_job.campaign_id,
        v_job.user_id,
        null::text,
        null::text,
        null::text,
        null::text,
        null::text,
        null::text;
      update public.campaign_worker_lock
      set lock_token = null, locked_until = null
      where singleton and lock_token = v_lock_token;
      return;
    end if;

    if v_job.attempt_count >= 1 then
      update public.campaign_recipients
      set
        status = 'failed',
        failed_at = now(),
        error_code = 'attempt_limit_reached',
        error_message = 'A tentativa única já foi utilizada; reenvio automático bloqueado.'
      where id = v_job.recipient_id
        and user_id = v_job.user_id
        and status = 'queued';
      continue;
    end if;

    v_attempt_token := v_lock_token;
    update public.campaign_recipients
    set
      status = 'sending',
      attempt_count = attempt_count + 1,
      attempt_token = v_attempt_token,
      attempt_started_at = now()
    where id = v_job.recipient_id
      and user_id = v_job.user_id
      and status = 'queued';

    update public.campaigns
    set
      status = 'running',
      started_at = coalesce(started_at, now())
    where id = v_job.campaign_id
      and user_id = v_job.user_id;

    return query
    select
      'claimed'::text,
      v_job.recipient_id,
      v_attempt_token,
      v_job.campaign_id,
      v_job.user_id,
      v_job.provider_instance_name,
      v_job.phone_snapshot,
      v_job.message_body,
      v_job.media_storage_path,
      v_job.media_content_type,
      v_job.media_file_name;
    return;
  end loop;
end;
$$;

revoke all on function public.claim_campaign_recipient() from public, anon, authenticated;
grant execute on function public.claim_campaign_recipient() to service_role;

create or replace function public.finish_campaign_recipient(
  p_recipient_id uuid,
  p_attempt_token uuid,
  p_status text,
  p_provider_message_id text default null,
  p_error_code text default null,
  p_error_message text default null
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_recipient public.campaign_recipients%rowtype;
  v_now timestamptz := now();
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'service_role_required';
  end if;

  if p_status is null or p_status not in ('sent', 'failed', 'skipped') then
    raise exception 'invalid_recipient_result';
  end if;

  select r.*
    into v_recipient
  from public.campaign_recipients as r
  where r.id = p_recipient_id
    and r.status = 'sending'
    and r.attempt_token = p_attempt_token
  for update;

  if not found then
    return false;
  end if;

  update public.campaign_recipients
  set
    status = p_status,
    provider_message_id = case
      when p_status = 'sent' then nullif(left(p_provider_message_id, 200), '')
      else null
    end,
    sent_at = case when p_status = 'sent' then v_now else null end,
    failed_at = case when p_status = 'failed' then v_now else null end,
    error_code = case when p_status = 'sent' then null else left(p_error_code, 100) end,
    error_message = case when p_status = 'sent' then null else left(p_error_message, 500) end,
    attempt_token = null,
    attempt_started_at = null
  where id = p_recipient_id;

  insert into public.message_logs (
    user_id,
    campaign_id,
    recipient_id,
    connection_id,
    provider_message_id,
    status,
    error_code,
    error_message,
    event_at
  )
  select
    v_recipient.user_id,
    v_recipient.campaign_id,
    v_recipient.id,
    c.connection_id,
    case when p_status = 'sent' then nullif(left(p_provider_message_id, 200), '') else null end,
    p_status,
    case when p_status = 'sent' then null else left(p_error_code, 100) end,
    case when p_status = 'sent' then null else left(p_error_message, 500) end,
    v_now
  from public.campaigns as c
  where c.id = v_recipient.campaign_id
    and c.user_id = v_recipient.user_id;

  update public.campaigns as c
  set
    status = 'completed',
    completed_at = v_now
  where c.id = v_recipient.campaign_id
    and c.user_id = v_recipient.user_id
    and c.status = 'running'
    and not exists (
      select 1
      from public.campaign_recipients as r
      where r.campaign_id = c.id
        and r.user_id = c.user_id
        and r.status in ('queued', 'sending')
    );

  update public.campaign_worker_lock
  set
    lock_token = null,
    locked_until = null,
    next_available_at = case
      when p_status = 'sent' then now() + interval '5 seconds'
      else next_available_at
    end
  where singleton
    and lock_token = p_attempt_token;

  return true;
end;
$$;

revoke all on function public.finish_campaign_recipient(uuid, uuid, text, text, text, text)
  from public, anon, authenticated;
grant execute on function public.finish_campaign_recipient(uuid, uuid, text, text, text, text)
  to service_role;

create or replace function public.get_campaign_report(
  p_start_date date,
  p_end_date date
)
returns table (
  report_date date,
  sent bigint,
  delivered bigint,
  read bigint,
  failed bigint,
  queued bigint
)
language plpgsql
stable
security invoker
set search_path = ''
as $$
begin
  if auth.uid() is null or not public.is_active_user() then
    raise exception 'active_user_required';
  end if;
  if p_start_date is null or p_end_date is null
    or p_end_date < p_start_date
    or p_end_date - p_start_date > 90
  then
    raise exception 'invalid_report_period';
  end if;

  return query
  with days as (
    select generate_series(p_start_date, p_end_date, interval '1 day')::date as day
  ),
  events as (
    select r.sent_at::date as day, 'sent'::text as kind
    from public.campaign_recipients as r
    where r.user_id = auth.uid()
      and r.sent_at >= p_start_date::timestamp
      and r.sent_at < (p_end_date + 1)::timestamp
    union all
    select r.delivered_at::date, 'delivered'::text
    from public.campaign_recipients as r
    where r.user_id = auth.uid()
      and r.delivered_at >= p_start_date::timestamp
      and r.delivered_at < (p_end_date + 1)::timestamp
    union all
    select r.read_at::date, 'read'::text
    from public.campaign_recipients as r
    where r.user_id = auth.uid()
      and r.read_at >= p_start_date::timestamp
      and r.read_at < (p_end_date + 1)::timestamp
    union all
    select r.failed_at::date, 'failed'::text
    from public.campaign_recipients as r
    where r.user_id = auth.uid()
      and r.failed_at >= p_start_date::timestamp
      and r.failed_at < (p_end_date + 1)::timestamp
    union all
    select r.queued_at::date, 'queued'::text
    from public.campaign_recipients as r
    where r.user_id = auth.uid()
      and r.status = 'queued'
      and r.queued_at >= p_start_date::timestamp
      and r.queued_at < (p_end_date + 1)::timestamp
  ),
  totals as (
    select
      e.day,
      count(*) filter (where e.kind = 'sent') as sent,
      count(*) filter (where e.kind = 'delivered') as delivered,
      count(*) filter (where e.kind = 'read') as read,
      count(*) filter (where e.kind = 'failed') as failed,
      count(*) filter (where e.kind = 'queued') as queued
    from events as e
    group by e.day
  )
  select
    d.day,
    coalesce(t.sent, 0)::bigint,
    coalesce(t.delivered, 0)::bigint,
    coalesce(t.read, 0)::bigint,
    coalesce(t.failed, 0)::bigint,
    coalesce(t.queued, 0)::bigint
  from days as d
  left join totals as t on t.day = d.day
  order by d.day;
end;
$$;

revoke all on function public.get_campaign_report(date, date) from public, anon;
grant execute on function public.get_campaign_report(date, date) to authenticated;
