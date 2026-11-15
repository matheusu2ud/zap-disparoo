drop index public.billing_intents_one_open_per_user_idx;
create unique index billing_intents_one_open_per_user_idx
  on public.billing_intents (user_id)
  where status in ('creating', 'pending', 'manual_review', 'confirmed');

alter table public.billing_intents
  drop constraint billing_intents_status_check;
alter table public.billing_intents
  add constraint billing_intents_status_check
  check (status in (
    'creating',
    'pending',
    'manual_review',
    'failed',
    'canceled',
    'expired',
    'confirmed'
  ));
alter table public.billing_intents
  add column last_status_checked_at timestamptz;

alter table public.subscriptions
  add column billing_intent_id uuid unique
    references public.billing_intents (id) on delete set null,
  add column provider_subscription_id text unique;

create or replace function public.claim_poseidonpay_subscription_check(
  p_billing_intent_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'service_role_required';
  end if;

  update public.billing_intents
  set last_status_checked_at = now()
  where id = p_billing_intent_id
    and status in ('pending', 'manual_review', 'confirmed')
    and (provider_subscription_id is not null or status = 'manual_review')
    and (
      last_status_checked_at is null
      or last_status_checked_at <= now() - interval '10 seconds'
    );

  return found;
end;
$$;

revoke all on function public.claim_poseidonpay_subscription_check(uuid)
  from public, anon, authenticated;
grant execute on function public.claim_poseidonpay_subscription_check(uuid)
  to service_role;

create or replace function public.apply_poseidonpay_subscription_status(
  p_billing_intent_id uuid,
  p_provider_subscription_id text,
  p_gateway_status text,
  p_interval_type text,
  p_interval_count integer,
  p_product_id text
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_intent public.billing_intents%rowtype;
  v_linked_subscription_id uuid;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'service_role_required';
  end if;

  if p_gateway_status is null
     or p_interval_type is null
     or p_interval_count is null
     or p_product_id is null
     or p_gateway_status not in ('ACTIVE', 'INACTIVE', 'CANCELED')
     or p_interval_type <> 'MONTHS'
     or p_interval_count <> 1 then
    raise exception 'invalid_poseidonpay_subscription_status';
  end if;

  select bi.*
    into v_intent
  from public.billing_intents as bi
  where bi.id = p_billing_intent_id
  for update;

  if not found
     or v_intent.provider_subscription_id is null
     or v_intent.provider_subscription_id <> p_provider_subscription_id
     or v_intent.plan_id::text <> p_product_id then
    raise exception 'poseidonpay_subscription_mismatch';
  end if;

  if v_intent.status in ('failed', 'expired', 'canceled') then
    raise exception 'billing_intent_not_verifiable';
  end if;

  select s.id
    into v_linked_subscription_id
  from public.subscriptions as s
  where s.billing_intent_id = v_intent.id
  for update;

  if v_linked_subscription_id is null then
    select s.id
      into v_linked_subscription_id
    from public.subscriptions as s
    where s.user_id = v_intent.user_id
    for update;
  end if;

  if p_gateway_status = 'ACTIVE' then
    if v_intent.status = 'confirmed' then
      update public.billing_intents
      set gateway_status = 'ACTIVE',
          last_status_checked_at = now()
      where id = v_intent.id;
      return 'confirmed';
    end if;

    perform pg_advisory_xact_lock(hashtextextended(v_intent.user_id::text, 1));

    update public.subscriptions as s
    set
      status = 'canceled',
      ends_at = case
        when s.ends_at is null then greatest(now(), s.starts_at) + interval '1 second'
        else s.ends_at
      end
    where s.user_id = v_intent.user_id
      and s.status in ('trialing', 'active', 'past_due')
      and s.id is distinct from v_linked_subscription_id;

    if v_linked_subscription_id is null then
      insert into public.subscriptions (
        user_id,
        plan_id,
        status,
        starts_at,
        ends_at,
        billing_intent_id,
        provider_subscription_id
      )
      values (
        v_intent.user_id,
        v_intent.plan_id,
        'active',
        now(),
        null,
        v_intent.id,
        p_provider_subscription_id
      );
    else
      update public.subscriptions
      set status = 'active',
          starts_at = now(),
          ends_at = null,
          plan_id = v_intent.plan_id,
          billing_intent_id = v_intent.id,
          provider_subscription_id = p_provider_subscription_id
      where id = v_linked_subscription_id;
    end if;

    update public.billing_intents
    set status = 'confirmed',
        gateway_status = 'ACTIVE',
        last_status_checked_at = now()
    where id = v_intent.id;

    return 'activated';
  end if;

  if p_gateway_status = 'CANCELED'
     or (p_gateway_status = 'INACTIVE' and v_intent.status = 'confirmed') then
    update public.subscriptions
    set status = 'canceled',
        ends_at = case
          when ends_at is null then greatest(now(), starts_at) + interval '1 second'
          else ends_at
        end
    where billing_intent_id = v_intent.id
      and status in ('trialing', 'active', 'past_due');

    update public.billing_intents
    set status = 'canceled',
        gateway_status = p_gateway_status,
        last_status_checked_at = now()
    where id = v_intent.id;

    return 'canceled';
  end if;

  update public.billing_intents
  set gateway_status = p_gateway_status,
      last_status_checked_at = now()
  where id = v_intent.id;

  return 'pending';
end;
$$;

revoke all on function public.apply_poseidonpay_subscription_status(
  uuid, text, text, text, integer, text
) from public, anon, authenticated;
grant execute on function public.apply_poseidonpay_subscription_status(
  uuid, text, text, text, integer, text
) to service_role;
