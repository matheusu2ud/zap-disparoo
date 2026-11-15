alter table public.whatsapp_connections
  add column provider_instance_name text unique;

revoke insert, update, delete on public.whatsapp_connections from authenticated;
grant select on public.whatsapp_connections to authenticated;

drop policy if exists "connections_admin_all" on public.whatsapp_connections;
drop policy if exists "connections_select_own" on public.whatsapp_connections;

create policy "connections_select_own"
  on public.whatsapp_connections for select to authenticated
  using (
    (user_id = (select auth.uid()) and (select public.is_active_user()))
    or (select public.is_admin())
  );

create policy "connections_admin_all"
  on public.whatsapp_connections for all to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));

create or replace function public.reserve_whatsapp_connection(p_label text)
returns table (
  id uuid,
  user_id uuid,
  label text,
  provider_instance_name text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_plan_id uuid;
  v_connections_limit integer;
  v_unlimited boolean;
  v_current_count bigint;
  v_connection_id uuid;
  v_instance_name text;
begin
  if v_user_id is null then
    raise exception 'authentication_required';
  end if;

  if not public.is_active_user() then
    raise exception 'account_inactive';
  end if;

  if p_label is null or length(trim(p_label)) < 1 or length(trim(p_label)) > 100 then
    raise exception 'invalid_connection_label';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(v_user_id::text, 0));

  select s.plan_id, p.connections_limit, p.unlimited_connections
    into v_plan_id, v_connections_limit, v_unlimited
  from public.subscriptions as s
  join public.plans as p on p.id = s.plan_id
  where s.user_id = v_user_id
    and s.status in ('active', 'trialing', 'past_due')
    and s.starts_at <= now()
    and (s.ends_at is null or s.ends_at > now())
  order by s.starts_at desc
  limit 1;

  if v_plan_id is null then
    raise exception 'active_plan_required';
  end if;

  select count(*) into v_current_count
  from public.whatsapp_connections as c
  where c.user_id = v_user_id;

  if not v_unlimited and v_current_count >= v_connections_limit then
    raise exception 'connection_limit_reached';
  end if;

  v_connection_id := gen_random_uuid();
  v_instance_name := 'bh_' || replace(v_connection_id::text, '-', '');

  insert into public.whatsapp_connections (
    id,
    user_id,
    label,
    provider_instance_name,
    status
  )
  values (
    v_connection_id,
    v_user_id,
    trim(p_label),
    v_instance_name,
    'connecting'
  );

  return query
  select v_connection_id, v_user_id, trim(p_label), v_instance_name;
end;
$$;

revoke all on function public.reserve_whatsapp_connection(text) from public, anon;
grant execute on function public.reserve_whatsapp_connection(text) to authenticated;
