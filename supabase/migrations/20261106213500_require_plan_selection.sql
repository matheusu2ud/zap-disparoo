alter table public.profiles
  add column if not exists plan_selected boolean not null default false;

drop trigger if exists broadcast_hub_assign_free_plan on public.profiles;

update public.profiles as profile
set plan_selected = true
from public.subscriptions as subscription
join public.plans as plan on plan.id = subscription.plan_id
where subscription.user_id = profile.id
  and subscription.status in ('trialing', 'active', 'past_due')
  and subscription.starts_at <= now()
  and (subscription.ends_at is null or subscription.ends_at > now())
  and plan.name like 'BROADCAST HUB - %'
  and plan.price > 0;

create or replace function public.has_broadcast_hub_access()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.profiles as profile
    join public.subscriptions as subscription
      on subscription.user_id = profile.id
    join public.plans as plan
      on plan.id = subscription.plan_id
    where profile.id = (select auth.uid())
      and profile.is_active
      and profile.plan_selected
      and plan.name like 'BROADCAST HUB - %'
      and plan.is_active
      and subscription.status in ('trialing', 'active', 'past_due')
      and subscription.starts_at <= now()
      and (subscription.ends_at is null or subscription.ends_at > now())
  );
$$;

revoke all on function public.has_broadcast_hub_access() from public, anon;
grant execute on function public.has_broadcast_hub_access() to authenticated;

create or replace function public.sync_broadcast_hub_plan_selection()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (
    select 1
    from public.subscriptions as subscription
    join public.plans as plan on plan.id = subscription.plan_id
    where subscription.user_id = new.user_id
      and subscription.status in ('trialing', 'active', 'past_due')
      and subscription.starts_at <= now()
      and (subscription.ends_at is null or subscription.ends_at > now())
      and plan.name like 'BROADCAST HUB - %'
      and plan.is_active
      and plan.price > 0
  ) then
    update public.profiles
    set plan_selected = true
    where id = new.user_id;
  end if;

  return new;
end;
$$;

revoke all on function public.sync_broadcast_hub_plan_selection() from public, anon, authenticated;

create trigger broadcast_hub_sync_plan_selection
  after insert or update on public.subscriptions
  for each row execute function public.sync_broadcast_hub_plan_selection();

create or replace function public.select_broadcast_hub_free_plan()
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_free_plan_id uuid;
  v_subscription_id uuid;
begin
  if v_user_id is null then
    raise exception 'authentication_required';
  end if;

  if not exists (
    select 1
    from public.profiles as profile
    where profile.id = v_user_id
      and profile.is_active
  ) then
    raise exception 'active_profile_required';
  end if;

  if public.has_broadcast_hub_access() then
    raise exception 'plan_already_selected';
  end if;

  if exists (
    select 1
    from public.billing_intents as intent
    where intent.user_id = v_user_id
      and intent.status in ('creating', 'pending', 'manual_review')
  ) then
    raise exception 'open_payment_exists';
  end if;

  select plan.id
    into v_free_plan_id
  from public.plans as plan
  where plan.name = 'BROADCAST HUB - Grátis'
    and plan.price = 0
    and plan.currency = 'BRL'
    and plan.is_active
  limit 1;

  if v_free_plan_id is null then
    raise exception 'broadcast_hub_free_plan_missing';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(v_user_id::text, 1));

  select subscription.id
    into v_subscription_id
  from public.subscriptions as subscription
  where subscription.user_id = v_user_id
  for update;

  if found then
    update public.subscriptions
    set plan_id = v_free_plan_id,
        status = 'active',
        starts_at = now(),
        ends_at = null,
        billing_intent_id = null,
        provider_subscription_id = null
    where id = v_subscription_id;
  else
    insert into public.subscriptions (user_id, plan_id, status)
    values (v_user_id, v_free_plan_id, 'active');
  end if;

  update public.profiles
  set plan_selected = true
  where id = v_user_id;

  return v_free_plan_id;
end;
$$;

revoke all on function public.select_broadcast_hub_free_plan() from public, anon;
grant execute on function public.select_broadcast_hub_free_plan() to authenticated;
