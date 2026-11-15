create table public.billing_intents (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  plan_id uuid not null references public.plans (id) on delete restrict,
  identifier text not null unique check (length(identifier) between 10 and 100),
  provider_transaction_id text unique,
  provider_order_id text,
  provider_subscription_id text,
  amount numeric(12, 2) not null check (amount > 0),
  currency text not null default 'BRL' check (currency = 'BRL'),
  status text not null default 'creating'
    check (status in ('creating', 'pending', 'manual_review', 'failed', 'canceled', 'expired')),
  gateway_status text,
  pix_code text,
  pix_expires_at timestamptz,
  checkout_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index billing_intents_one_open_per_user_idx
  on public.billing_intents (user_id)
  where status in ('creating', 'pending', 'manual_review');
create index billing_intents_user_created_idx
  on public.billing_intents (user_id, created_at desc);

alter table public.billing_intents enable row level security;

revoke all on public.billing_intents from public, anon, authenticated;
grant select on public.billing_intents to authenticated;
grant select, insert, update on public.billing_intents to service_role;

create policy "billing_intents_select_own"
  on public.billing_intents for select to authenticated
  using (user_id = (select auth.uid()) and (select public.is_active_user()));

create trigger billing_intents_set_updated_at
  before update on public.billing_intents
  for each row execute function public.set_updated_at();
