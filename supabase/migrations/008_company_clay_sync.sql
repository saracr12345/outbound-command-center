-- Outbound Command Center — Milestone 9
-- Company-only RB2B visitors can be pushed to Clay Companies independently.

begin;

create table if not exists public.clay_company_syncs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  company_id uuid not null references public.companies(id) on delete cascade,
  visit_id uuid references public.website_visits(id) on delete set null,

  status text not null default 'pending'
    check (status in ('pending', 'synced', 'failed')),

  request_payload jsonb not null default '{}'::jsonb,
  response_payload jsonb not null default '{}'::jsonb,
  error_message text,

  synced_by uuid references auth.users(id) on delete set null,
  synced_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique (organization_id, company_id)
);

create index if not exists clay_company_syncs_org_created_idx
  on public.clay_company_syncs(organization_id, created_at desc);

create index if not exists clay_company_syncs_org_status_idx
  on public.clay_company_syncs(organization_id, status);

drop trigger if exists clay_company_syncs_set_updated_at on public.clay_company_syncs;
create trigger clay_company_syncs_set_updated_at
before update on public.clay_company_syncs
for each row execute function public.set_updated_at();

alter table public.clay_company_syncs enable row level security;

drop policy if exists "Members can view Clay company syncs" on public.clay_company_syncs;
create policy "Members can view Clay company syncs"
on public.clay_company_syncs
for select
to authenticated
using (public.is_org_member(organization_id));

drop policy if exists "Members can create Clay company syncs" on public.clay_company_syncs;
create policy "Members can create Clay company syncs"
on public.clay_company_syncs
for insert
to authenticated
with check (
  public.is_org_member(organization_id)
  and (synced_by is null or synced_by = (select auth.uid()))
);

drop policy if exists "Members can update Clay company syncs" on public.clay_company_syncs;
create policy "Members can update Clay company syncs"
on public.clay_company_syncs
for update
to authenticated
using (public.is_org_member(organization_id))
with check (public.is_org_member(organization_id));

revoke all on table public.clay_company_syncs from anon;
grant select, insert, update on table public.clay_company_syncs to authenticated;

commit;
