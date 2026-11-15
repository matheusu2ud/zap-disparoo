create or replace function public.select_broadcast_hub_free_plan()
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_free_plan_id uuid;
  v_subscription public.subscriptions%rowtype;
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

  if exists (
    select 1
    from public.billing_intents as intent
    where intent.user_id = v_user_id
      and intent.status in ('creating', 'pending', 'manual_review')
  ) then
    raise exception 'open_payment_exists';
  end if;

  select subscription.*
    into v_subscription
  from public.subscriptions as subscription
  where subscription.user_id = v_user_id
    and subscription.status in ('trialing', 'active', 'past_due')
    and subscription.starts_at <= now()
    and (subscription.ends_at is null or subscription.ends_at > now())
  order by subscription.starts_at desc
  limit 1
  for update;

  if found and v_subscription.plan_id = v_free_plan_id then
    update public.profiles
    set plan_selected = true
    where id = v_user_id;

    return v_free_plan_id;
  end if;

  if found and v_subscription.provider_subscription_id is not null then
    raise exception 'paid_plan_change_requires_cancellation';
  end if;

  if not found then
    select subscription.*
      into v_subscription
    from public.subscriptions as subscription
    where subscription.user_id = v_user_id
    order by subscription.created_at desc
    limit 1
    for update;

    if found and v_subscription.provider_subscription_id is not null then
      raise exception 'paid_plan_change_requires_cancellation';
    end if;
  end if;

  if v_subscription.id is not null then
    update public.subscriptions
    set plan_id = v_free_plan_id,
        status = 'active',
        starts_at = now(),
        ends_at = null,
        billing_intent_id = null,
        provider_subscription_id = null
    where id = v_subscription.id;
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
