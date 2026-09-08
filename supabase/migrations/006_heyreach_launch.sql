-- Outbound Command Center — Milestone 7
-- Safe HeyReach launch tracking + suppression controls.

begin;

create table if not exists public.outreach_launches (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  lead_id uuid not null references public.leads(id) on delete cascade,
  draft_id uuid references public.outreach_drafts(id) on delete set null,
  visit_id uuid references public.website_visits(id) on delete set null,
  provider text not null check (provider in ('heyreach', 'clay')),
  channel text not null check (channel in ('linkedin', 'email')),
  external_campaign_id text not null,
  external_campaign_name text,
  status text not null default 'submitting'
    check (status in ('submitting', 'launched', 'failed')),
  request_snapshot jsonb not null default '{}'::jsonb,
  provider_response jsonb not null default '{}'::jsonb,
  error_message text,
  launched_by uuid references auth.users(id) on delete set null,
  launched_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.outreach_suppressions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  lead_id uuid references public.leads(id) on delete cascade,
  email text,
  linkedin_url text,
  reason text,
  active boolean not null default true,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint outreach_suppression_has_target check (
    lead_id is not null
    or nullif(trim(coalesce(email, '')), '') is not null
    or nullif(trim(coalesce(linkedin_url, '')), '') is not null
  )
);

create unique index if not exists outreach_launches_unique_active_idx
  on public.outreach_launches (
    organization_id,
    lead_id,
    provider,
    channel,
    external_campaign_id
  )
  where status in ('submitting', 'launched');

create index if not exists outreach_launches_org_created_idx
  on public.outreach_launches(organization_id, created_at desc);

create index if not exists outreach_suppressions_org_active_idx
  on public.outreach_suppressions(organization_id, active);

create index if not exists outreach_suppressions_lead_idx
  on public.outreach_suppressions(organization_id, lead_id)
  where lead_id is not null;

create index if not exists outreach_suppressions_linkedin_idx
  on public.outreach_suppressions(organization_id, linkedin_url)
  where linkedin_url is not null;

drop trigger if exists outreach_launches_set_updated_at on public.outreach_launches;
create trigger outreach_launches_set_updated_at
before update on public.outreach_launches
for each row execute function public.set_updated_at();

drop trigger if exists outreach_suppressions_set_updated_at on public.outreach_suppressions;
create trigger outreach_suppressions_set_updated_at
before update on public.outreach_suppressions
for each row execute function public.set_updated_at();

alter table public.outreach_launches enable row level security;
alter table public.outreach_suppressions enable row level security;

drop policy if exists "Members can view outreach launches" on public.outreach_launches;
create policy "Members can view outreach launches"
on public.outreach_launches
for select
to authenticated
using (public.is_org_member(organization_id));

drop policy if exists "Members can create outreach launches" on public.outreach_launches;
create policy "Members can create outreach launches"
on public.outreach_launches
for insert
to authenticated
with check (
  public.is_org_member(organization_id)
  and (launched_by is null or launched_by = (select auth.uid()))
);

drop policy if exists "Members can update outreach launches" on public.outreach_launches;
create policy "Members can update outreach launches"
on public.outreach_launches
for update
to authenticated
using (public.is_org_member(organization_id))
with check (public.is_org_member(organization_id));

drop policy if exists "Members can view suppressions" on public.outreach_suppressions;
create policy "Members can view suppressions"
on public.outreach_suppressions
for select
to authenticated
using (public.is_org_member(organization_id));

drop policy if exists "Managers can manage suppressions" on public.outreach_suppressions;
create policy "Managers can manage suppressions"
on public.outreach_suppressions
for all
to authenticated
using (
  exists (
    select 1
    from public.organization_members membership
    where membership.organization_id = outreach_suppressions.organization_id
      and membership.user_id = (select auth.uid())
      and membership.role in ('admin', 'manager')
  )
)
with check (
  exists (
    select 1
    from public.organization_members membership
    where membership.organization_id = outreach_suppressions.organization_id
      and membership.user_id = (select auth.uid())
      and membership.role in ('admin', 'manager')
  )
);

grant select, insert, update on table public.outreach_launches to authenticated;
grant select, insert, update, delete on table public.outreach_suppressions to authenticated;

commit;
