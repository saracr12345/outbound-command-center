-- Milestone 6.1: backfill LinkedIn URLs already present in stored RB2B Slack payloads.
-- New Slack events are handled by the updated parser/route; this migration repairs
-- existing leads/companies where the URL was present in the Slack event but not persisted.

with lead_sources as (
  select
    l.id,
    coalesce(l.metadata -> 'slack_rb2b' ->> 'raw_text', '') || ' ' ||
    coalesce(string_agg(w.payload::text, ' '), '') as source_text
  from public.leads l
  left join public.website_visits w on w.lead_id = l.id
  where l.linkedin_url is null
  group by l.id, l.metadata
),
lead_candidates as (
  select
    id,
    (regexp_match(
      source_text,
      '(https?://(www\.)?linkedin\.com/in/[^[:space:]<>"()]+)',
      'i'
    ))[1] as linkedin_url
  from lead_sources
)
update public.leads l
set linkedin_url = regexp_replace(c.linkedin_url, '[,.;]+$', '')
from lead_candidates c
where l.id = c.id
  and c.linkedin_url is not null
  and l.linkedin_url is null;

with company_sources as (
  select
    c.id,
    coalesce(c.metadata -> 'slack_rb2b' ->> 'raw_text', '') || ' ' ||
    coalesce(string_agg(w.payload::text, ' '), '') as source_text
  from public.companies c
  left join public.website_visits w on w.company_id = c.id
  where c.linkedin_url is null
  group by c.id, c.metadata
),
company_candidates as (
  select
    id,
    (regexp_match(
      source_text,
      '(https?://(www\.)?linkedin\.com/company/[^[:space:]<>"()]+)',
      'i'
    ))[1] as linkedin_url
  from company_sources
)
update public.companies c
set linkedin_url = regexp_replace(x.linkedin_url, '[,.;]+$', '')
from company_candidates x
where c.id = x.id
  and x.linkedin_url is not null
  and c.linkedin_url is null;
