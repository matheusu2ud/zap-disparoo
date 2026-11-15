create or replace function public.schedule_campaign(
  p_campaign_id uuid,
  p_scheduled_at timestamptz default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_campaign public.campaigns%rowtype;
  v_recipient_count bigint;
  v_valid_recipient_count bigint;
begin
  if v_user_id is null then
    raise exception 'authentication_required';
  end if;

  if not public.is_active_user() then
    raise exception 'account_inactive';
  end if;

  select c.*
    into v_campaign
  from public.campaigns as c
  where c.id = p_campaign_id
    and c.user_id = v_user_id
  for update;

  if not found or v_campaign.status <> 'draft' then
    raise exception 'campaign_not_editable';
  end if;

  if length(trim(v_campaign.name)) = 0
    or length(trim(v_campaign.message_body)) = 0
  then
    raise exception 'campaign_content_required';
  end if;

  if v_campaign.connection_id is null or not exists (
    select 1
    from public.whatsapp_connections as c
    where c.id = v_campaign.connection_id
      and c.user_id = v_user_id
      and c.status = 'connected'
  ) then
    raise exception 'campaign_connection_not_connected';
  end if;

  if p_scheduled_at is not null and p_scheduled_at <= now() then
    raise exception 'campaign_schedule_must_be_future';
  end if;

  select count(*)
    into v_recipient_count
  from public.campaign_recipients as r
  where r.campaign_id = p_campaign_id
    and r.user_id = v_user_id;

  if v_recipient_count = 0 then
    raise exception 'campaign_empty_queue';
  end if;

  select count(*)
    into v_valid_recipient_count
  from public.campaign_recipients as r
  join public.contacts as c
    on c.id = r.contact_id
    and c.user_id = r.user_id
  where r.campaign_id = p_campaign_id
    and r.user_id = v_user_id
    and r.status = 'queued'
    and r.phone_snapshot = c.phone
    and c.consent_status = 'opted_in'
    and c.consented_at is not null
    and c.opted_out_at is null;

  if v_recipient_count <> v_valid_recipient_count then
    raise exception 'campaign_recipients_consent_changed';
  end if;

  update public.campaigns
  set
    status = 'scheduled',
    scheduled_at = coalesce(p_scheduled_at, now())
  where id = p_campaign_id
    and user_id = v_user_id;
end;
$$;

revoke all on function public.schedule_campaign(uuid, timestamptz)
  from public, anon;
grant execute on function public.schedule_campaign(uuid, timestamptz)
  to authenticated;

create or replace function public.cancel_campaign(p_campaign_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_status text;
begin
  if v_user_id is null then
    raise exception 'authentication_required';
  end if;

  if not public.is_active_user() then
    raise exception 'account_inactive';
  end if;

  select c.status
    into v_status
  from public.campaigns as c
  where c.id = p_campaign_id
    and c.user_id = v_user_id
  for update;

  if not found or v_status not in ('scheduled', 'queued', 'paused') then
    raise exception 'campaign_not_cancelable';
  end if;

  update public.campaign_recipients
  set status = 'canceled'
  where campaign_id = p_campaign_id
    and user_id = v_user_id
    and status = 'queued';

  update public.campaigns
  set status = 'canceled'
  where id = p_campaign_id
    and user_id = v_user_id;
end;
$$;

revoke all on function public.cancel_campaign(uuid) from public, anon;
grant execute on function public.cancel_campaign(uuid) to authenticated;
