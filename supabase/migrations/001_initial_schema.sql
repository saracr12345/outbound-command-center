-- Outbound Command Center — Milestone 2
-- Multi-user organisation schema, leads and Row Level Security.
--
-- IMPORTANT:
-- Before running this file, set bootstrap_email near the bottom
-- to the exact email address you use to log in to the dashboard.

begin;

create extension if not exists pgcrypto;

do $$
begin
  create type public.member_role as enum ('admin', 'manager', 'member', 'viewer');
exception
  when duplicate_object then null;
end
$$;

do $$
begin
  create type public.lead_source as enum ('manual', 'rb2b', 'clay', 'apify', 'heyreach', 'import');
exception
  when duplicate_object then null;
end
$$;

do $$
begin
  create type public.lead_status as enum (
    'new',
    'researching',
    'enriched',
    'qualified',
    'approved',
    'campaign_active',
    'replied',
    'interested',
    'not_interested',
    'archived'
  );
exception
  when duplicate_object then null;
end
$$;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text,
  avatar_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.organization_members (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role public.member_role not null default 'member',
  created_at timestamptz not null default now(),
  primary key (organization_id, user_id)
);

create table if not exists public.companies (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  domain text,
  website_url text,
  linkedin_url text,
  industry text,
  employee_count integer check (employee_count is null or employee_count >= 0),
  country text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.leads (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  company_id uuid references public.companies(id) on delete set null,
  first_name text,
  last_name text,
  job_title text,
  email text,
  phone text,
  linkedin_url text,
  source public.lead_source not null default 'manual',
  status public.lead_status not null default 'new',
  icp_score integer check (icp_score is null or icp_score between 0 and 100),
  owner_user_id uuid references auth.users(id) on delete set null,
  created_by uuid references auth.users(id) on delete set null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint lead_has_identity check (
    nullif(trim(coalesce(first_name, '')), '') is not null
    or nullif(trim(coalesce(last_name, '')), '') is not null
    or nullif(trim(coalesce(email, '')), '') is not null
    or nullif(trim(coalesce(linkedin_url, '')), '') is not null
  )
);

create table if not exists public.website_visits (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  company_id uuid references public.companies(id) on delete set null,
  lead_id uuid references public.leads(id) on delete set null,
  source text not null default 'rb2b',
  page_url text,
  page_title text,
  referrer_url text,
  visitor_id text,
  occurred_at timestamptz not null default now(),
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.activities (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  lead_id uuid references public.leads(id) on delete cascade,
  company_id uuid references public.companies(id) on delete cascade,
  actor_user_id uuid references auth.users(id) on delete set null,
  activity_type text not null,
  title text not null,
  description text,
  metadata jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create table if not exists public.integration_connections (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  provider text not null check (provider in ('rb2b', 'clay', 'apify', 'heyreach')),
  status text not null default 'not_connected'
    check (status in ('not_connected', 'connected', 'error', 'disabled')),
  external_account_id text,
  config jsonb not null default '{}'::jsonb,
  last_synced_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, provider)
);

create index if not exists organization_members_user_id_idx
  on public.organization_members(user_id);

create index if not exists companies_organization_id_idx
  on public.companies(organization_id);

create index if not exists companies_domain_idx
  on public.companies(organization_id, domain);

create index if not exists leads_organization_id_created_at_idx
  on public.leads(organization_id, created_at desc);

create index if not exists leads_company_id_idx
  on public.leads(company_id);

create index if not exists leads_email_idx
  on public.leads(organization_id, email);

create index if not exists website_visits_organization_occurred_idx
  on public.website_visits(organization_id, occurred_at desc);

create index if not exists activities_organization_occurred_idx
  on public.activities(organization_id, occurred_at desc);

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

drop trigger if exists profiles_set_updated_at on public.profiles;
create trigger profiles_set_updated_at
before update on public.profiles
for each row execute function public.set_updated_at();

drop trigger if exists organizations_set_updated_at on public.organizations;
create trigger organizations_set_updated_at
before update on public.organizations
for each row execute function public.set_updated_at();

drop trigger if exists companies_set_updated_at on public.companies;
create trigger companies_set_updated_at
before update on public.companies
for each row execute function public.set_updated_at();

drop trigger if exists leads_set_updated_at on public.leads;
create trigger leads_set_updated_at
before update on public.leads
for each row execute function public.set_updated_at();

drop trigger if exists integration_connections_set_updated_at
on public.integration_connections;
create trigger integration_connections_set_updated_at
before update on public.integration_connections
for each row execute function public.set_updated_at();

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, full_name)
  values (
    new.id,
    nullif(trim(coalesce(new.raw_user_meta_data ->> 'full_name', '')), '')
  )
  on conflict (id) do nothing;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

create or replace function public.is_org_member(target_organization_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.organization_members membership
    where membership.organization_id = target_organization_id
      and membership.user_id = (select auth.uid())
  );
$$;

create or replace function public.is_org_admin(target_organization_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.organization_members membership
    where membership.organization_id = target_organization_id
      and membership.user_id = (select auth.uid())
      and membership.role = 'admin'
  );
$$;

revoke all on function public.is_org_member(uuid) from public;
revoke all on function public.is_org_admin(uuid) from public;
grant execute on function public.is_org_member(uuid) to authenticated;
grant execute on function public.is_org_admin(uuid) to authenticated;

alter table public.profiles enable row level security;
alter table public.organizations enable row level security;
alter table public.organization_members enable row level security;
alter table public.companies enable row level security;
alter table public.leads enable row level security;
alter table public.website_visits enable row level security;
alter table public.activities enable row level security;
alter table public.integration_connections enable row level security;

drop policy if exists "Users can view their own profile" on public.profiles;
create policy "Users can view their own profile"
on public.profiles
for select
to authenticated
using ((select auth.uid()) = id);

drop policy if exists "Users can update their own profile" on public.profiles;
create policy "Users can update their own profile"
on public.profiles
for update
to authenticated
using ((select auth.uid()) = id)
with check ((select auth.uid()) = id);

drop policy if exists "Members can view their organization" on public.organizations;
create policy "Members can view their organization"
on public.organizations
for select
to authenticated
using (public.is_org_member(id));

drop policy if exists "Admins can update their organization" on public.organizations;
create policy "Admins can update their organization"
on public.organizations
for update
to authenticated
using (public.is_org_admin(id))
with check (public.is_org_admin(id));

drop policy if exists "Members can view organization membership" on public.organization_members;
create policy "Members can view organization membership"
on public.organization_members
for select
to authenticated
using (public.is_org_member(organization_id));

drop policy if exists "Admins can add organization members" on public.organization_members;
create policy "Admins can add organization members"
on public.organization_members
for insert
to authenticated
with check (public.is_org_admin(organization_id));

drop policy if exists "Admins can update organization members" on public.organization_members;
create policy "Admins can update organization members"
on public.organization_members
for update
to authenticated
using (public.is_org_admin(organization_id))
with check (public.is_org_admin(organization_id));

drop policy if exists "Admins can remove organization members" on public.organization_members;
create policy "Admins can remove organization members"
on public.organization_members
for delete
to authenticated
using (public.is_org_admin(organization_id));

drop policy if exists "Members can view companies" on public.companies;
create policy "Members can view companies"
on public.companies
for select
to authenticated
using (public.is_org_member(organization_id));

drop policy if exists "Members can create companies" on public.companies;
create policy "Members can create companies"
on public.companies
for insert
to authenticated
with check (public.is_org_member(organization_id));

drop policy if exists "Members can update companies" on public.companies;
create policy "Members can update companies"
on public.companies
for update
to authenticated
using (public.is_org_member(organization_id))
with check (public.is_org_member(organization_id));

drop policy if exists "Managers can delete companies" on public.companies;
create policy "Managers can delete companies"
on public.companies
for delete
to authenticated
using (
  exists (
    select 1
    from public.organization_members membership
    where membership.organization_id = companies.organization_id
      and membership.user_id = (select auth.uid())
      and membership.role in ('admin', 'manager')
  )
);

drop policy if exists "Members can view leads" on public.leads;
create policy "Members can view leads"
on public.leads
for select
to authenticated
using (public.is_org_member(organization_id));

drop policy if exists "Members can create leads" on public.leads;
create policy "Members can create leads"
on public.leads
for insert
to authenticated
with check (
  public.is_org_member(organization_id)
  and (
    created_by is null
    or created_by = (select auth.uid())
  )
);

drop policy if exists "Members can update leads" on public.leads;
create policy "Members can update leads"
on public.leads
for update
to authenticated
using (public.is_org_member(organization_id))
with check (public.is_org_member(organization_id));

drop policy if exists "Managers can delete leads" on public.leads;
create policy "Managers can delete leads"
on public.leads
for delete
to authenticated
using (
  exists (
    select 1
    from public.organization_members membership
    where membership.organization_id = leads.organization_id
      and membership.user_id = (select auth.uid())
      and membership.role in ('admin', 'manager')
  )
);

drop policy if exists "Members can view website visits" on public.website_visits;
create policy "Members can view website visits"
on public.website_visits
for select
to authenticated
using (public.is_org_member(organization_id));

drop policy if exists "Members can create website visits" on public.website_visits;
create policy "Members can create website visits"
on public.website_visits
for insert
to authenticated
with check (public.is_org_member(organization_id));

drop policy if exists "Members can update website visits" on public.website_visits;
create policy "Members can update website visits"
on public.website_visits
for update
to authenticated
using (public.is_org_member(organization_id))
with check (public.is_org_member(organization_id));

drop policy if exists "Members can view activities" on public.activities;
create policy "Members can view activities"
on public.activities
for select
to authenticated
using (public.is_org_member(organization_id));

drop policy if exists "Members can create activities" on public.activities;
create policy "Members can create activities"
on public.activities
for insert
to authenticated
with check (
  public.is_org_member(organization_id)
  and (
    actor_user_id is null
    or actor_user_id = (select auth.uid())
  )
);

drop policy if exists "Members can view integration status"
on public.integration_connections;
create policy "Members can view integration status"
on public.integration_connections
for select
to authenticated
using (public.is_org_member(organization_id));

drop policy if exists "Admins can create integrations"
on public.integration_connections;
create policy "Admins can create integrations"
on public.integration_connections
for insert
to authenticated
with check (public.is_org_admin(organization_id));

drop policy if exists "Admins can update integrations"
on public.integration_connections;
create policy "Admins can update integrations"
on public.integration_connections
for update
to authenticated
using (public.is_org_admin(organization_id))
with check (public.is_org_admin(organization_id));

drop policy if exists "Admins can delete integrations"
on public.integration_connections;
create policy "Admins can delete integrations"
on public.integration_connections
for delete
to authenticated
using (public.is_org_admin(organization_id));

revoke all on table public.profiles from anon;
revoke all on table public.organizations from anon;
revoke all on table public.organization_members from anon;
revoke all on table public.companies from anon;
revoke all on table public.leads from anon;
revoke all on table public.website_visits from anon;
revoke all on table public.activities from anon;
revoke all on table public.integration_connections from anon;

grant select, insert, update on table public.profiles to authenticated;
grant select, update on table public.organizations to authenticated;
grant select, insert, update, delete on table public.organization_members to authenticated;
grant select, insert, update, delete on table public.companies to authenticated;
grant select, insert, update, delete on table public.leads to authenticated;
grant select, insert, update on table public.website_visits to authenticated;
grant select, insert on table public.activities to authenticated;
grant select, insert, update, delete on table public.integration_connections to authenticated;

-- ---------------------------------------------------------------------------
-- BOOTSTRAP YOUR EXISTING LOGIN
-- Set bootstrap_email to the email you use in Supabase Authentication.
-- You can also change the organization name and slug.
-- ---------------------------------------------------------------------------

do $$
declare
  bootstrap_email text := 'sara.craciun@t-3.ai';
  bootstrap_user_id uuid;
  bootstrap_organization_id uuid; 
begin
  if bootstrap_email is null or trim(bootstrap_email) = '' then
    raise exception 'Set bootstrap_email to your Supabase login email before running this script.';
  end if;

  select id
  into bootstrap_user_id
  from auth.users
  where lower(email) = lower(bootstrap_email)
  limit 1;

  if bootstrap_user_id is null then
    raise exception 'No Supabase Auth user found for email: %', bootstrap_email;
  end if;

  insert into public.profiles (id, full_name)
  values (bootstrap_user_id, split_part(bootstrap_email, '@', 1))
  on conflict (id) do nothing;

  select organization_id
  into bootstrap_organization_id
  from public.organization_members
  where user_id = bootstrap_user_id
  order by created_at
  limit 1;

  if bootstrap_organization_id is null then
    insert into public.organizations (name, slug)
    values (
      'Outbound Command Center',
      'outbound-command-center-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 8)
    )
    returning id into bootstrap_organization_id;

    insert into public.organization_members (
      organization_id,
      user_id,
      role
    )
    values (
      bootstrap_organization_id,
      bootstrap_user_id,
      'admin'
    );
  end if;

  insert into public.integration_connections (
    organization_id,
    provider,
    status
  )
  values
    (bootstrap_organization_id, 'rb2b', 'not_connected'),
    (bootstrap_organization_id, 'clay', 'not_connected'),
    (bootstrap_organization_id, 'apify', 'not_connected'),
    (bootstrap_organization_id, 'heyreach', 'not_connected')
  on conflict (organization_id, provider) do nothing;
end
$$;

commit;
