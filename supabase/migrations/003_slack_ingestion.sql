-- Outbound Command Center — Milestone 4
-- Allow Slack Events API deliveries to use the existing webhook event log.

begin;

alter table public.webhook_events
  drop constraint if exists webhook_events_provider_check;

alter table public.webhook_events
  add constraint webhook_events_provider_check
  check (provider in ('rb2b', 'slack', 'clay', 'apify', 'heyreach'));

create index if not exists webhook_events_provider_received_idx
  on public.webhook_events(provider, received_at desc);

commit;
