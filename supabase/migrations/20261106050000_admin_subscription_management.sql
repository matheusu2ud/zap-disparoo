create or replace function public.admin_assign_subscription(
  p_user_id uuid,
  p_plan_id uuid,
  p_ends_at timestamptz default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_subscription_id uuid;
begin
  if auth.uid() is null or not public.is_admin() then
    raise exception 'admin_required';
  end if;

  if not exists (
    select 1
    from public.profiles as p
    where p.id = p_user_id
  ) then
    raise exception 'admin_user_not_found';
  end if;

  if not exists (
    select 1
    from public.plans as p
    where p.id = p_plan_id
      and p.is_active
  ) then
    raise exception 'admin_active_plan_required';
  end if;

  if p_ends_at is not null and p_ends_at <= now() then
    raise exception 'admin_subscription_end_must_be_future';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text, 1));

  select s.id
    into v_subscription_id
  from public.subscriptions as s
  where s.user_id = p_user_id
  for update;

  if found then
    update public.subscriptions
    set plan_id = p_plan_id,
        status = 'active',
        starts_at = now(),
        ends_at = p_ends_at
    where id = v_subscription_id;
  else
    insert into public.subscriptions (
      user_id,
      plan_id,
      status,
      starts_at,
      ends_at
    )
    values (
      p_user_id,
      p_plan_id,
      'active',
      now(),
      p_ends_at
    )
    returning id into v_subscription_id;
  end if;

  return v_subscription_id;
end;
$$;

revoke all on function public.admin_assign_subscription(uuid, uuid, timestamptz)
  from public, anon;
grant execute on function public.admin_assign_subscription(uuid, uuid, timestamptz)
  to authenticated;
