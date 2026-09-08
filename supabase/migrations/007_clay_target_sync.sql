-- Outbound Command Center — Milestone 8
-- Human target approval + controlled sync into Clay People / Companies intake webhooks.

begin;

create table if not exists public.clay_target_syncs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  lead_id uuid not null references public.leads(id) on delete cascade,
  company_id uuid references public.companies(id) on delete set null,
  analysis_id uuid references public.lead_analyses(id) on delete set null,
  visit_id uuid references public.website_visits(id) on delete set null,

  target_status text not null default 'approved'
    check (target_status in ('approved', 'revoked')),

  person_status text not null default 'pending'
    check (person_status in ('pending', 'synced', 'failed', 'skipped')),
  company_status text not null default 'pending'
    check (company_status in ('pending', 'synced', 'failed', 'skipped')),

  person_request jsonb not null default '{}'::jsonb,
  person_response jsonb not null default '{}'::jsonb,
  company_request jsonb not null default '{}'::jsonb,
  company_response jsonb not null default '{}'::jsonb,
  error_message text,

  approved_by uuid references auth.users(id) on delete set null,
  approved_at timestamptz not null default now(),
  synced_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique (organization_id, lead_id)
);

create index if not exists clay_target_syncs_org_created_idx
  on public.clay_target_syncs(organization_id, created_at desc);

create index if not exists clay_target_syncs_org_status_idx
  on public.clay_target_syncs(organization_id, target_status, person_status, company_status);

drop trigger if exists clay_target_syncs_set_updated_at on public.clay_target_syncs;
create trigger clay_target_syncs_set_updated_at
before update on public.clay_target_syncs
for each row execute function public.set_updated_at();

alter table public.clay_target_syncs enable row level security;

drop policy if exists "Members can view Clay target syncs" on public.clay_target_syncs;
create policy "Members can view Clay target syncs"
on public.clay_target_syncs
for select
to authenticated
using (public.is_org_member(organization_id));

drop policy if exists "Members can create Clay target syncs" on public.clay_target_syncs;
create policy "Members can create Clay target syncs"
on public.clay_target_syncs
for insert
to authenticated
with check (
  public.is_org_member(organization_id)
  and (approved_by is null or approved_by = (select auth.uid()))
);

drop policy if exists "Members can update Clay target syncs" on public.clay_target_syncs;
create policy "Members can update Clay target syncs"
on public.clay_target_syncs
for update
to authenticated
using (public.is_org_member(organization_id))
with check (public.is_org_member(organization_id));

revoke all on table public.clay_target_syncs from anon;
grant select, insert, update on table public.clay_target_syncs to authenticated;

commit;
