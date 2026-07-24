-- Outbound Command Center — Milestone 3
-- Adds durable RB2B webhook event logging and deduplication.

begin;

create table if not exists public.webhook_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  provider text not null check (provider in ('rb2b', 'clay', 'apify', 'heyreach')),
  event_hash text not null,
  status text not null default 'processing'
    check (status in ('processing', 'completed', 'failed', 'ignored')),
  payload jsonb not null default '{}'::jsonb,
  error_message text,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  created_at timestamptz not null default now(),
  unique (organization_id, provider, event_hash)
);

create index if not exists webhook_events_organization_received_idx
  on public.webhook_events(organization_id, received_at desc);

alter table public.webhook_events enable row level security;

drop policy if exists "Admins can view webhook events"
on public.webhook_events;
create policy "Admins can view webhook events"
on public.webhook_events
for select
to authenticated
using (public.is_org_admin(organization_id));

drop policy if exists "Admins can delete webhook events"
on public.webhook_events;
create policy "Admins can delete webhook events"
on public.webhook_events
for delete
to authenticated
using (public.is_org_admin(organization_id));

revoke all on table public.webhook_events from anon;
grant select, delete on table public.webhook_events to authenticated;

commit;
