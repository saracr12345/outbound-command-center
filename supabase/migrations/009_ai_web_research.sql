-- Outbound Command Center — Milestone 9.1
-- Store professional public-web research used by the AI target analysis.

begin;

alter table public.lead_analyses
  add column if not exists research jsonb not null default '{}'::jsonb;

alter table public.lead_analyses
  add column if not exists research_sources jsonb not null default '[]'::jsonb;

comment on column public.lead_analyses.research is
  'Professional public-web research used to supplement missing B2B targeting fields.';

comment on column public.lead_analyses.research_sources is
  'Public URLs returned by the OpenAI web-search tool for the analysis.';

commit;
