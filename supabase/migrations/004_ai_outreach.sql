-- Outbound Command Center — Milestone 6
-- AI target analysis + personalised outreach drafts with human approval.

begin;

create table if not exists public.lead_analyses (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  lead_id uuid not null references public.leads(id) on delete cascade,
  visit_id uuid references public.website_visits(id) on delete set null,
  score integer not null check (score between 0 and 100),
  classification text not null
    check (classification in ('strong_target', 'review', 'low_priority')),
  summary text not null,
  criteria jsonb not null default '{}'::jsonb,
  positive_signals jsonb not null default '[]'::jsonb,
  concerns jsonb not null default '[]'::jsonb,
  missing_information jsonb not null default '[]'::jsonb,
  recommended_angle text not null,
  input_snapshot jsonb not null default '{}'::jsonb,
  model text not null,
  prompt_version text not null,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.outreach_drafts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  lead_id uuid not null references public.leads(id) on delete cascade,
  visit_id uuid references public.website_visits(id) on delete set null,
  analysis_id uuid references public.lead_analyses(id) on delete set null,
  status text not null default 'draft'
    check (status in ('draft', 'approved', 'rejected', 'launched')),
  email_subject text not null,
  email_body text not null,
  linkedin_connection_note text not null,
  linkedin_followup text not null,
  model text not null,
  prompt_version text not null,
  created_by uuid references auth.users(id) on delete set null,
  approved_by uuid references auth.users(id) on delete set null,
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists lead_analyses_org_lead_created_idx
  on public.lead_analyses(organization_id, lead_id, created_at desc);

create index if not exists outreach_drafts_org_lead_created_idx
  on public.outreach_drafts(organization_id, lead_id, created_at desc);

create index if not exists outreach_drafts_status_idx
  on public.outreach_drafts(organization_id, status);

drop trigger if exists outreach_drafts_set_updated_at
on public.outreach_drafts;
create trigger outreach_drafts_set_updated_at
before update on public.outreach_drafts
for each row execute function public.set_updated_at();

alter table public.lead_analyses enable row level security;
alter table public.outreach_drafts enable row level security;

drop policy if exists "Members can view lead analyses"
on public.lead_analyses;
create policy "Members can view lead analyses"
on public.lead_analyses
for select
to authenticated
using (public.is_org_member(organization_id));

drop policy if exists "Members can create lead analyses"
on public.lead_analyses;
create policy "Members can create lead analyses"
on public.lead_analyses
for insert
to authenticated
with check (
  public.is_org_member(organization_id)
  and (created_by is null or created_by = (select auth.uid()))
);

drop policy if exists "Managers can delete lead analyses"
on public.lead_analyses;
create policy "Managers can delete lead analyses"
on public.lead_analyses
for delete
to authenticated
using (
  exists (
    select 1
    from public.organization_members membership
    where membership.organization_id = lead_analyses.organization_id
      and membership.user_id = (select auth.uid())
      and membership.role in ('admin', 'manager')
  )
);

drop policy if exists "Members can view outreach drafts"
on public.outreach_drafts;
create policy "Members can view outreach drafts"
on public.outreach_drafts
for select
to authenticated
using (public.is_org_member(organization_id));

drop policy if exists "Members can create outreach drafts"
on public.outreach_drafts;
create policy "Members can create outreach drafts"
on public.outreach_drafts
for insert
to authenticated
with check (
  public.is_org_member(organization_id)
  and (created_by is null or created_by = (select auth.uid()))
);

drop policy if exists "Members can update outreach drafts"
on public.outreach_drafts;
create policy "Members can update outreach drafts"
on public.outreach_drafts
for update
to authenticated
using (public.is_org_member(organization_id))
with check (public.is_org_member(organization_id));

drop policy if exists "Managers can delete outreach drafts"
on public.outreach_drafts;
create policy "Managers can delete outreach drafts"
on public.outreach_drafts
for delete
to authenticated
using (
  exists (
    select 1
    from public.organization_members membership
    where membership.organization_id = outreach_drafts.organization_id
      and membership.user_id = (select auth.uid())
      and membership.role in ('admin', 'manager')
  )
);

revoke all on table public.lead_analyses from anon;
revoke all on table public.outreach_drafts from anon;

grant select, insert, delete on table public.lead_analyses to authenticated;
grant select, insert, update, delete on table public.outreach_drafts to authenticated;

commit;
