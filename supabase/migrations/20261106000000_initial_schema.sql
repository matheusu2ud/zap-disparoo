create extension if not exists pgcrypto with schema extensions;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text,
  full_name text,
  avatar_url text,
  role text not null default 'client' check (role in ('client', 'user', 'admin')),
  status text not null default 'active' check (status in ('active', 'blocked')),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.profiles
  add column if not exists email text,
  add column if not exists avatar_url text,
  add column if not exists status text not null default 'active',
  add column if not exists is_active boolean not null default true;

update public.profiles
set is_active = (status = 'active')
where is_active is distinct from (status = 'active');

update public.profiles as p
set email = u.email
from auth.users as u
where u.id = p.id
  and p.email is distinct from u.email;

alter table public.profiles
  drop constraint if exists profiles_role_check;
alter table public.profiles
  add constraint profiles_role_check
  check (role in ('client', 'user', 'admin'));

create or replace function public.sync_broadcast_hub_profile_status()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' then
    if new.is_active is distinct from old.is_active then
      new.status := case when new.is_active then 'active' else 'blocked' end;
    elsif new.status is distinct from old.status then
      new.is_active := new.status = 'active';
    end if;
  else
    new.is_active := new.status = 'active';
  end if;
  return new;
end;
$$;

create trigger broadcast_hub_profiles_sync_status
  before insert or update of status, is_active on public.profiles
  for each row execute function public.sync_broadcast_hub_profile_status();

create or replace function public.fill_broadcast_hub_profile_email()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.email is null then
    select u.email into new.email
    from auth.users as u
    where u.id = new.id;
  end if;
  return new;
end;
$$;

revoke all on function public.fill_broadcast_hub_profile_email() from public, anon, authenticated;

create trigger broadcast_hub_profiles_fill_email
  before insert on public.profiles
  for each row execute function public.fill_broadcast_hub_profile_email();

create or replace function public.sync_broadcast_hub_profile_email()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.profiles
  set email = new.email
  where id = new.id
    and email is distinct from new.email;
  return new;
end;
$$;

revoke all on function public.sync_broadcast_hub_profile_email() from public, anon, authenticated;

create trigger broadcast_hub_auth_user_email_updated
  after update of email on auth.users
  for each row execute function public.sync_broadcast_hub_profile_email();

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.profiles as p
    where p.id = (select auth.uid())
      and lower(trim(p.role)) in ('admin', 'administração', 'administracao')
      and lower(trim(p.status)) in ('active', 'ativo')
  );
$$;

revoke all on function public.is_admin() from public;
grant execute on function public.is_admin() to anon, authenticated;

create or replace function public.is_active_user()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.profiles as p
    where p.id = (select auth.uid())
      and p.is_active
  );
$$;

revoke all on function public.is_active_user() from public;
grant execute on function public.is_active_user() to authenticated;

create table if not exists public.plans (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  description text not null default '',
  price numeric(12, 2) not null default 0 check (price >= 0),
  currency text not null default 'BRL' check (currency ~ '^[A-Z]{3}$'),
  duration_days integer not null default 30,
  max_devices integer not null default 1,
  active boolean not null default true,
  monthly_credits integer not null default 0,
  messages_limit bigint not null default 0 check (messages_limit >= 0),
  campaigns_limit bigint not null default 0 check (campaigns_limit >= 0),
  contacts_limit bigint not null default 0 check (contacts_limit >= 0),
  connections_limit integer not null default 1 check (connections_limit >= 0),
  storage_limit bigint not null default 0 check (storage_limit >= 0),
  unlimited_messages boolean not null default false,
  unlimited_campaigns boolean not null default false,
  unlimited_contacts boolean not null default false,
  unlimited_connections boolean not null default false,
  features jsonb not null default '{}'::jsonb check (jsonb_typeof(features) = 'object'),
  is_active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.plans
  add column if not exists currency text not null default 'BRL',
  add column if not exists duration_days integer not null default 30,
  add column if not exists max_devices integer not null default 1,
  add column if not exists active boolean not null default true,
  add column if not exists monthly_credits integer not null default 0,
  add column if not exists messages_limit bigint not null default 0,
  add column if not exists campaigns_limit bigint not null default 0,
  add column if not exists contacts_limit bigint not null default 0,
  add column if not exists connections_limit integer not null default 1,
  add column if not exists storage_limit bigint not null default 0,
  add column if not exists unlimited_messages boolean not null default false,
  add column if not exists unlimited_campaigns boolean not null default false,
  add column if not exists unlimited_contacts boolean not null default false,
  add column if not exists unlimited_connections boolean not null default false,
  add column if not exists features jsonb not null default '{}'::jsonb,
  add column if not exists is_active boolean not null default true,
  add column if not exists sort_order integer not null default 0,
  add column if not exists updated_at timestamptz not null default now();

update public.plans
set is_active = active,
    connections_limit = max_devices,
    messages_limit = monthly_credits
where is_active is distinct from active
   or connections_limit is distinct from max_devices
   or messages_limit is distinct from monthly_credits;

create or replace function public.sync_broadcast_hub_plan_fields()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' then
    if new.is_active is distinct from old.is_active then
      new.active := new.is_active;
    elsif new.active is distinct from old.active then
      new.is_active := new.active;
    end if;

    if new.connections_limit is distinct from old.connections_limit then
      new.max_devices := new.connections_limit;
    elsif new.max_devices is distinct from old.max_devices then
      new.connections_limit := new.max_devices;
    end if;

    if new.messages_limit is distinct from old.messages_limit then
      new.monthly_credits := least(new.messages_limit, 2147483647)::integer;
    elsif new.monthly_credits is distinct from old.monthly_credits then
      new.messages_limit := new.monthly_credits;
    end if;
  else
    if new.is_active is distinct from true then
      new.active := new.is_active;
    else
      new.is_active := new.active;
    end if;

    if new.connections_limit is distinct from 1 then
      new.max_devices := new.connections_limit;
    else
      new.connections_limit := new.max_devices;
    end if;

    if new.messages_limit <> 0 then
      new.monthly_credits := least(new.messages_limit, 2147483647)::integer;
    else
      new.messages_limit := new.monthly_credits;
    end if;
  end if;
  return new;
end;
$$;

create trigger broadcast_hub_plans_sync_fields
  before insert or update of active, is_active, max_devices, connections_limit,
    monthly_credits, messages_limit on public.plans
  for each row execute function public.sync_broadcast_hub_plan_fields();

create table if not exists public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  plan_id uuid not null references public.plans (id) on delete restrict,
  status text not null default 'active'
    check (status in ('pending', 'trialing', 'active', 'past_due', 'blocked', 'canceled', 'cancelled', 'expired')),
  starts_at timestamptz not null default now(),
  ends_at timestamptz,
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_at is null or ends_at > starts_at),
  unique (user_id, id)
);

alter table public.subscriptions
  add column if not exists ends_at timestamptz;

update public.subscriptions
set ends_at = expires_at
where ends_at is null
  and expires_at is not null;

alter table public.subscriptions
  drop constraint if exists subscriptions_status_check;
alter table public.subscriptions
  add constraint subscriptions_status_check
  check (status in (
    'pending',
    'trialing',
    'active',
    'past_due',
    'blocked',
    'canceled',
    'cancelled',
    'expired'
  ));

create unique index if not exists subscriptions_user_id_id_unique_idx
  on public.subscriptions (user_id, id);

create or replace function public.sync_broadcast_hub_subscription_dates()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' then
    if new.ends_at is distinct from old.ends_at then
      new.expires_at := new.ends_at;
    elsif new.expires_at is distinct from old.expires_at then
      new.ends_at := new.expires_at;
    end if;
  else
    new.ends_at := coalesce(new.ends_at, new.expires_at);
    new.expires_at := new.ends_at;
  end if;
  return new;
end;
$$;

create trigger broadcast_hub_subscriptions_sync_dates
  before insert or update of ends_at, expires_at on public.subscriptions
  for each row execute function public.sync_broadcast_hub_subscription_dates();

create unique index subscriptions_one_current_per_user
  on public.subscriptions (user_id)
  where status in ('trialing', 'active', 'past_due');

create table public.contacts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null check (length(trim(name)) between 1 and 200),
  phone text not null check (length(trim(phone)) between 5 and 32),
  email text,
  consent_status text not null default 'unknown'
    check (consent_status in ('unknown', 'opted_in', 'opted_out')),
  consented_at timestamptz,
  consent_source text,
  opted_out_at timestamptz,
  notes text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, id),
  unique (user_id, phone),
  check (
    (
      consent_status <> 'opted_in'
      or (
        consented_at is not null
        and length(trim(coalesce(consent_source, ''))) > 0
      )
    )
    and (consent_status <> 'opted_out' or opted_out_at is not null)
  )
);

create index contacts_user_name_idx on public.contacts (user_id, name);

create or replace function public.prevent_contact_opt_out_reset()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.opted_out_at is not null
     and (
       new.opted_out_at is distinct from old.opted_out_at
       or new.consent_status <> 'opted_out'
     )
     and not public.is_admin() then
    raise exception 'Opt-out status cannot be removed by a user';
  end if;

  return new;
end;
$$;

revoke all on function public.prevent_contact_opt_out_reset() from public, anon, authenticated;

create trigger contacts_preserve_opt_out
  before update on public.contacts
  for each row execute function public.prevent_contact_opt_out_reset();

create or replace function public.protect_contact_consent()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if coalesce(auth.role(), '') <> 'service_role'
     and not public.is_admin()
     and (
       new.consent_status is distinct from old.consent_status
       or new.consented_at is distinct from old.consented_at
       or new.consent_source is distinct from old.consent_source
       or new.opted_out_at is distinct from old.opted_out_at
     ) then
    raise exception 'Consent records must be changed by a trusted server action';
  end if;

  return new;
end;
$$;

revoke all on function public.protect_contact_consent() from public, anon, authenticated;

create trigger contacts_protect_consent
  before update on public.contacts
  for each row execute function public.protect_contact_consent();

create table public.contact_tags (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  contact_id uuid not null,
  tag_name text not null check (length(trim(tag_name)) between 1 and 60),
  created_at timestamptz not null default now(),
  foreign key (user_id, contact_id)
    references public.contacts (user_id, id) on delete cascade
);

create unique index contact_tags_unique_name
  on public.contact_tags (user_id, contact_id, lower(tag_name));
create index contact_tags_user_tag_idx
  on public.contact_tags (user_id, lower(tag_name));

create table public.whatsapp_connections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  label text not null check (length(trim(label)) between 1 and 100),
  provider_instance_id text,
  phone_number text,
  status text not null default 'disconnected'
    check (status in ('disconnected', 'connecting', 'connected', 'error')),
  connected_at timestamptz,
  last_seen_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, id)
);

create unique index whatsapp_connections_provider_instance_idx
  on public.whatsapp_connections (provider_instance_id)
  where provider_instance_id is not null;
create index whatsapp_connections_user_status_idx
  on public.whatsapp_connections (user_id, status);

create table public.campaigns (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  connection_id uuid,
  name text not null check (length(trim(name)) between 1 and 200),
  message_body text not null default '',
  media_file_id uuid,
  status text not null default 'draft'
    check (status in ('draft', 'scheduled', 'queued', 'running', 'paused', 'completed', 'canceled', 'failed')),
  scheduled_at timestamptz,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, id),
  foreign key (user_id, connection_id)
    references public.whatsapp_connections (user_id, id) on delete set null (connection_id)
);

create index campaigns_user_created_idx on public.campaigns (user_id, created_at desc);
create index campaigns_user_status_idx on public.campaigns (user_id, status);

create table public.media_files (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  file_name text not null check (length(trim(file_name)) between 1 and 255),
  storage_path text not null unique,
  content_type text not null,
  size_bytes bigint not null check (size_bytes > 0),
  created_at timestamptz not null default now(),
  unique (user_id, id),
  check (storage_path like user_id::text || '/%')
);

alter table public.campaigns
  add constraint campaigns_media_file_owner_fk
  foreign key (user_id, media_file_id)
  references public.media_files (user_id, id) on delete set null (media_file_id);

create table public.campaign_recipients (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  campaign_id uuid not null,
  contact_id uuid not null,
  phone_snapshot text not null,
  status text not null default 'queued'
    check (status in ('queued', 'sent', 'delivered', 'read', 'failed', 'skipped', 'canceled')),
  provider_message_id text,
  error_code text,
  error_message text,
  queued_at timestamptz not null default now(),
  sent_at timestamptz,
  delivered_at timestamptz,
  read_at timestamptz,
  created_at timestamptz not null default now(),
  foreign key (user_id, campaign_id)
    references public.campaigns (user_id, id) on delete cascade,
  foreign key (user_id, contact_id)
    references public.contacts (user_id, id) on delete restrict,
  unique (user_id, id),
  unique (campaign_id, contact_id)
);

create index campaign_recipients_queue_idx
  on public.campaign_recipients (campaign_id, status, queued_at);
create index campaign_recipients_user_status_idx
  on public.campaign_recipients (user_id, status);

create table public.message_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  campaign_id uuid,
  recipient_id uuid,
  connection_id uuid,
  provider_message_id text,
  status text not null
    check (status in ('queued', 'sent', 'delivered', 'read', 'failed', 'skipped', 'canceled')),
  error_code text,
  error_message text,
  event_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  foreign key (user_id, campaign_id)
    references public.campaigns (user_id, id) on delete set null (campaign_id),
  foreign key (user_id, recipient_id)
    references public.campaign_recipients (user_id, id) on delete set null (recipient_id),
  foreign key (user_id, connection_id)
    references public.whatsapp_connections (user_id, id) on delete set null (connection_id)
);

create index message_logs_user_event_idx
  on public.message_logs (user_id, event_at desc);
create index message_logs_campaign_idx on public.message_logs (campaign_id, event_at desc);

create table public.message_templates (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null check (length(trim(name)) between 1 and 160),
  category text not null default 'general',
  body text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, id)
);

create index message_templates_user_name_idx
  on public.message_templates (user_id, name);

create table public.webhook_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users (id) on delete set null,
  provider text not null,
  provider_event_id text,
  event_type text not null,
  payload jsonb not null default '{}'::jsonb,
  processing_status text not null default 'pending'
    check (processing_status in ('pending', 'processing', 'processed', 'failed', 'ignored')),
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  unique (provider, provider_event_id)
);

create index webhook_events_pending_idx
  on public.webhook_events (processing_status, received_at)
  where processing_status in ('pending', 'failed');
create index webhook_events_user_received_idx
  on public.webhook_events (user_id, received_at desc);

create table public.usage_records (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  subscription_id uuid,
  metric text not null check (length(trim(metric)) between 1 and 80),
  quantity bigint not null check (quantity >= 0),
  period_start timestamptz not null,
  period_end timestamptz not null,
  metadata jsonb not null default '{}'::jsonb
    check (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz not null default now(),
  foreign key (user_id, subscription_id)
    references public.subscriptions (user_id, id) on delete set null (subscription_id),
  check (period_end > period_start)
);

create index usage_records_user_metric_period_idx
  on public.usage_records (user_id, metric, period_start, period_end);

create table public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users (id) on delete set null,
  actor_user_id uuid references auth.users (id) on delete set null,
  action text not null check (length(trim(action)) between 1 and 120),
  resource_type text not null check (length(trim(resource_type)) between 1 and 80),
  resource_id text,
  details jsonb not null default '{}'::jsonb
    check (jsonb_typeof(details) = 'object'),
  created_at timestamptz not null default now()
);

create index audit_logs_user_created_idx
  on public.audit_logs (user_id, created_at desc);

create table public.user_settings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references auth.users (id) on delete cascade,
  timezone text not null default 'America/Sao_Paulo',
  locale text not null default 'pt-BR',
  preferences jsonb not null default '{}'::jsonb
    check (jsonb_typeof(preferences) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();
create trigger plans_set_updated_at
  before update on public.plans
  for each row execute function public.set_updated_at();
create trigger subscriptions_set_updated_at
  before update on public.subscriptions
  for each row execute function public.set_updated_at();
create trigger contacts_set_updated_at
  before update on public.contacts
  for each row execute function public.set_updated_at();
create trigger connections_set_updated_at
  before update on public.whatsapp_connections
  for each row execute function public.set_updated_at();
create trigger campaigns_set_updated_at
  before update on public.campaigns
  for each row execute function public.set_updated_at();
create trigger templates_set_updated_at
  before update on public.message_templates
  for each row execute function public.set_updated_at();
create trigger user_settings_set_updated_at
  before update on public.user_settings
  for each row execute function public.set_updated_at();

alter table public.profiles enable row level security;
alter table public.plans enable row level security;
alter table public.subscriptions enable row level security;
alter table public.contacts enable row level security;
alter table public.contact_tags enable row level security;
alter table public.whatsapp_connections enable row level security;
alter table public.campaigns enable row level security;
alter table public.campaign_recipients enable row level security;
alter table public.message_logs enable row level security;
alter table public.message_templates enable row level security;
alter table public.media_files enable row level security;
alter table public.webhook_events enable row level security;
alter table public.usage_records enable row level security;
alter table public.audit_logs enable row level security;
alter table public.user_settings enable row level security;

grant select on public.profiles to authenticated;
grant update (full_name, avatar_url, role, is_active) on public.profiles to authenticated;
grant select on public.plans to anon, authenticated;
grant insert, update, delete on public.plans to authenticated;
grant select on public.subscriptions to authenticated;
grant insert, update, delete on public.subscriptions to authenticated;
grant select, insert, update, delete on public.contacts to authenticated;
grant select, insert, update, delete on public.contact_tags to authenticated;
grant select on public.whatsapp_connections to authenticated;
grant insert, update, delete on public.whatsapp_connections to authenticated;
grant select, insert, update, delete on public.campaigns to authenticated;
grant select, insert on public.campaign_recipients to authenticated;
grant select on public.message_logs to authenticated;
grant select, insert, update, delete on public.message_templates to authenticated;
grant select, insert, update, delete on public.media_files to authenticated;
grant select on public.webhook_events to authenticated;
grant select on public.usage_records to authenticated;
grant select on public.audit_logs to authenticated;
grant select, insert, update, delete on public.user_settings to authenticated;

create policy "profiles_select_self_or_admin"
  on public.profiles for select to authenticated
  using (id = (select auth.uid()) or (select public.is_admin()));
create policy "profiles_update_self"
  on public.profiles for update to authenticated
  using (id = (select auth.uid()) and role in ('client', 'user') and is_active)
  with check (id = (select auth.uid()) and role in ('client', 'user') and is_active);
create policy "profiles_admin_update"
  on public.profiles for update to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));

create policy "plans_select_active_or_admin"
  on public.plans for select to anon, authenticated
  using (is_active or (select public.is_admin()));
create policy "plans_admin_all"
  on public.plans for all to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));

create policy "subscriptions_select_self_or_admin"
  on public.subscriptions for select to authenticated
  using (
    (user_id = (select auth.uid()) and (select public.is_active_user()))
    or (select public.is_admin())
  );
create policy "subscriptions_admin_all"
  on public.subscriptions for all to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));

create policy "contacts_select_own"
  on public.contacts for select to authenticated
  using (
    (user_id = (select auth.uid()) and (select public.is_active_user()))
    or (select public.is_admin())
  );
create policy "contacts_insert_own"
  on public.contacts for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and (select public.is_active_user())
    and consent_status = 'unknown'
    and consented_at is null
    and consent_source is null
    and opted_out_at is null
  );
create policy "contacts_update_own"
  on public.contacts for update to authenticated
  using (
    (user_id = (select auth.uid()) and (select public.is_active_user()))
    or (select public.is_admin())
  )
  with check (
    (user_id = (select auth.uid()) and (select public.is_active_user()))
    or (select public.is_admin())
  );
create policy "contacts_delete_own"
  on public.contacts for delete to authenticated
  using (
    (user_id = (select auth.uid()) and (select public.is_active_user()))
    or (select public.is_admin())
  );

create policy "contact_tags_select_own"
  on public.contact_tags for select to authenticated
  using (
    (user_id = (select auth.uid()) and (select public.is_active_user()))
    or (select public.is_admin())
  );
create policy "contact_tags_insert_own"
  on public.contact_tags for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and (select public.is_active_user())
  );
create policy "contact_tags_update_own"
  on public.contact_tags for update to authenticated
  using (
    (user_id = (select auth.uid()) and (select public.is_active_user()))
    or (select public.is_admin())
  )
  with check (
    (user_id = (select auth.uid()) and (select public.is_active_user()))
    or (select public.is_admin())
  );
create policy "contact_tags_delete_own"
  on public.contact_tags for delete to authenticated
  using (
    (user_id = (select auth.uid()) and (select public.is_active_user()))
    or (select public.is_admin())
  );

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

create policy "campaigns_select_own"
  on public.campaigns for select to authenticated
  using (
    (user_id = (select auth.uid()) and (select public.is_active_user()))
    or (select public.is_admin())
  );
create policy "campaigns_insert_draft"
  on public.campaigns for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and (select public.is_active_user())
    and status = 'draft'
  );
create policy "campaigns_update_draft"
  on public.campaigns for update to authenticated
  using (
    user_id = (select auth.uid())
    and (select public.is_active_user())
    and status = 'draft'
  )
  with check (
    user_id = (select auth.uid())
    and (select public.is_active_user())
    and status = 'draft'
  );
create policy "campaigns_delete_draft"
  on public.campaigns for delete to authenticated
  using (
    user_id = (select auth.uid())
    and (select public.is_active_user())
    and status = 'draft'
  );
create policy "campaign_recipients_select_own"
  on public.campaign_recipients for select to authenticated
  using (
    (user_id = (select auth.uid()) and (select public.is_active_user()))
    or (select public.is_admin())
  );
create policy "campaign_recipients_insert_consented"
  on public.campaign_recipients for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and (select public.is_active_user())
    and status = 'queued'
    and exists (
      select 1
      from public.contacts as c
      where c.id = campaign_recipients.contact_id
        and c.user_id = campaign_recipients.user_id
        and c.phone = campaign_recipients.phone_snapshot
        and c.consent_status = 'opted_in'
        and c.consented_at is not null
        and c.opted_out_at is null
    )
    and exists (
      select 1
      from public.campaigns as c
      where c.id = campaign_recipients.campaign_id
        and c.user_id = campaign_recipients.user_id
        and c.status = 'draft'
    )
  );
create policy "message_logs_select_own"
  on public.message_logs for select to authenticated
  using (
    (user_id = (select auth.uid()) and (select public.is_active_user()))
    or (select public.is_admin())
  );

create policy "templates_select_own"
  on public.message_templates for select to authenticated
  using (
    (user_id = (select auth.uid()) and (select public.is_active_user()))
    or (select public.is_admin())
  );
create policy "templates_insert_own"
  on public.message_templates for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and (select public.is_active_user())
  );
create policy "templates_update_own"
  on public.message_templates for update to authenticated
  using (
    (user_id = (select auth.uid()) and (select public.is_active_user()))
    or (select public.is_admin())
  )
  with check (
    (user_id = (select auth.uid()) and (select public.is_active_user()))
    or (select public.is_admin())
  );
create policy "templates_delete_own"
  on public.message_templates for delete to authenticated
  using (
    (user_id = (select auth.uid()) and (select public.is_active_user()))
    or (select public.is_admin())
  );

create policy "media_files_select_own"
  on public.media_files for select to authenticated
  using (
    (user_id = (select auth.uid()) and (select public.is_active_user()))
    or (select public.is_admin())
  );
create policy "media_files_insert_own"
  on public.media_files for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and (select public.is_active_user())
  );
create policy "media_files_update_own"
  on public.media_files for update to authenticated
  using (
    (user_id = (select auth.uid()) and (select public.is_active_user()))
    or (select public.is_admin())
  )
  with check (
    (user_id = (select auth.uid()) and (select public.is_active_user()))
    or (select public.is_admin())
  );
create policy "media_files_delete_own"
  on public.media_files for delete to authenticated
  using (
    (user_id = (select auth.uid()) and (select public.is_active_user()))
    or (select public.is_admin())
  );

create policy "webhook_events_select_own_or_admin"
  on public.webhook_events for select to authenticated
  using (
    (user_id = (select auth.uid()) and (select public.is_active_user()))
    or (select public.is_admin())
  );

create policy "usage_records_select_own_or_admin"
  on public.usage_records for select to authenticated
  using (
    (user_id = (select auth.uid()) and (select public.is_active_user()))
    or (select public.is_admin())
  );

create policy "audit_logs_select_own_or_admin"
  on public.audit_logs for select to authenticated
  using (
    (user_id = (select auth.uid()) and (select public.is_active_user()))
    or (actor_user_id = (select auth.uid()) and (select public.is_active_user()))
    or (select public.is_admin())
  );

create policy "user_settings_select_own"
  on public.user_settings for select to authenticated
  using (
    (user_id = (select auth.uid()) and (select public.is_active_user()))
    or (select public.is_admin())
  );
create policy "user_settings_insert_own"
  on public.user_settings for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and (select public.is_active_user())
  );
create policy "user_settings_update_own"
  on public.user_settings for update to authenticated
  using (
    (user_id = (select auth.uid()) and (select public.is_active_user()))
    or (select public.is_admin())
  )
  with check (
    (user_id = (select auth.uid()) and (select public.is_active_user()))
    or (select public.is_admin())
  );
create policy "user_settings_delete_own"
  on public.user_settings for delete to authenticated
  using (
    (user_id = (select auth.uid()) and (select public.is_active_user()))
    or (select public.is_admin())
  );

insert into storage.buckets (id, name, public)
values ('broadcast-media', 'broadcast-media', false)
on conflict (id) do update set public = false;

create policy "broadcast_media_read_own"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'broadcast-media'
    and (select public.is_active_user())
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );
create policy "broadcast_media_insert_own"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'broadcast-media'
    and (select public.is_active_user())
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );
create policy "broadcast_media_update_own"
  on storage.objects for update to authenticated
  using (
    bucket_id = 'broadcast-media'
    and (select public.is_active_user())
    and (storage.foldername(name))[1] = (select auth.uid())::text
  )
  with check (
    bucket_id = 'broadcast-media'
    and (select public.is_active_user())
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );
create policy "broadcast_media_delete_own"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'broadcast-media'
    and (select public.is_active_user())
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );
