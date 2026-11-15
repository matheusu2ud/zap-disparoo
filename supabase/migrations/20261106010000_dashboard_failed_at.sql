alter table public.campaign_recipients
  add column failed_at timestamptz;

create index campaign_recipients_failed_at_idx
  on public.campaign_recipients (user_id, failed_at desc)
  where status = 'failed';
