insert into public.plans (
  name,
  description,
  price,
  currency,
  messages_limit,
  campaigns_limit,
  contacts_limit,
  connections_limit,
  storage_limit,
  unlimited_messages,
  unlimited_campaigns,
  unlimited_contacts,
  unlimited_connections,
  is_active,
  sort_order
)
values
  (
    'BROADCAST HUB - Grátis',
    '100 mensagens/mês, 1 campanha/mês, 100 contatos, 1 conexão e 100 MB.',
    0,
    'BRL',
    100,
    1,
    100,
    1,
    104857600,
    false,
    false,
    false,
    false,
    true,
    0
  ),
  (
    'BROADCAST HUB - Essencial',
    'R$ 10,00/mês: 1.000 mensagens/mês, 10 campanhas/mês, 1.000 contatos, 1 conexão e 500 MB.',
    10,
    'BRL',
    1000,
    10,
    1000,
    1,
    524288000,
    false,
    false,
    false,
    false,
    true,
    1
  ),
  (
    'BROADCAST HUB - Profissional',
    'R$ 19,99/mês: 5.000 mensagens/mês, 50 campanhas/mês, 5.000 contatos, 3 conexões e 2 GB.',
    19.99,
    'BRL',
    5000,
    50,
    5000,
    3,
    2147483648,
    false,
    false,
    false,
    false,
    true,
    2
  )
on conflict (name) do update
set
  description = excluded.description,
  price = excluded.price,
  currency = excluded.currency,
  messages_limit = excluded.messages_limit,
  campaigns_limit = excluded.campaigns_limit,
  contacts_limit = excluded.contacts_limit,
  connections_limit = excluded.connections_limit,
  storage_limit = excluded.storage_limit,
  unlimited_messages = excluded.unlimited_messages,
  unlimited_campaigns = excluded.unlimited_campaigns,
  unlimited_contacts = excluded.unlimited_contacts,
  unlimited_connections = excluded.unlimited_connections,
  is_active = excluded.is_active,
  sort_order = excluded.sort_order,
  updated_at = now();

create or replace function public.enforce_plan_resource_limits()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := new.user_id;
  v_plan record;
  v_usage bigint;
begin
  if v_user_id is null then
    raise exception 'user_required';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(v_user_id::text, 0));

  select
    p.messages_limit,
    p.campaigns_limit,
    p.contacts_limit,
    p.storage_limit,
    p.unlimited_messages,
    p.unlimited_campaigns,
    p.unlimited_contacts
  into v_plan
  from public.subscriptions as s
  join public.plans as p on p.id = s.plan_id
  where s.user_id = v_user_id
    and s.status in ('active', 'trialing', 'past_due')
    and s.starts_at <= now()
    and (s.ends_at is null or s.ends_at > now())
    and p.is_active
  order by s.starts_at desc
  limit 1;

  if not found then
    raise exception 'active_plan_required';
  end if;

  if tg_table_name = 'contacts' and not v_plan.unlimited_contacts then
    select count(*) into v_usage
    from public.contacts
    where user_id = v_user_id;

    if v_usage >= v_plan.contacts_limit then
      raise exception 'contact_limit_reached';
    end if;
  elsif tg_table_name = 'campaigns' and not v_plan.unlimited_campaigns then
    select count(*) into v_usage
    from public.campaigns
    where user_id = v_user_id
      and created_at >= date_trunc('month', now())
      and created_at < date_trunc('month', now()) + interval '1 month';

    if v_usage >= v_plan.campaigns_limit then
      raise exception 'monthly_campaign_limit_reached';
    end if;
  elsif tg_table_name = 'media_files' then
    select coalesce(sum(size_bytes), 0) into v_usage
    from public.media_files
    where user_id = v_user_id;

    if v_usage + new.size_bytes > v_plan.storage_limit then
      raise exception 'storage_limit_reached';
    end if;
  end if;

  return new;
end;
$$;

revoke all on function public.enforce_plan_resource_limits() from public, anon, authenticated;

create trigger contacts_enforce_plan_limit
  before insert on public.contacts
  for each row execute function public.enforce_plan_resource_limits();

create trigger campaigns_enforce_plan_limit
  before insert on public.campaigns
  for each row execute function public.enforce_plan_resource_limits();

create trigger media_files_enforce_plan_limit
  before insert on public.media_files
  for each row execute function public.enforce_plan_resource_limits();

create or replace function public.assign_broadcast_hub_free_plan()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_free_plan_id uuid;
begin
  select id into v_free_plan_id
  from public.plans
  where name = 'BROADCAST HUB - Grátis'
    and price = 0
    and is_active
  limit 1;

  if v_free_plan_id is null then
    raise exception 'broadcast_hub_free_plan_missing';
  end if;

  if not exists (
    select 1
    from public.subscriptions
    where user_id = new.id
  ) then
    insert into public.subscriptions (user_id, plan_id, status)
    values (new.id, v_free_plan_id, 'active');
  end if;

  return new;
end;
$$;

revoke all on function public.assign_broadcast_hub_free_plan() from public, anon, authenticated;

create trigger broadcast_hub_assign_free_plan
  after insert on public.profiles
  for each row execute function public.assign_broadcast_hub_free_plan();

insert into public.subscriptions (user_id, plan_id, status)
select p.id, free_plan.id, 'active'
from public.profiles as p
cross join lateral (
  select id
  from public.plans
  where name = 'BROADCAST HUB - Grátis'
    and price = 0
    and is_active
  limit 1
) as free_plan
where not exists (
  select 1
  from public.subscriptions as s
  where s.user_id = p.id
);
