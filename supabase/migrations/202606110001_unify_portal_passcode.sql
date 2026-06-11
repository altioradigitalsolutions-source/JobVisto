-- Migration: Ensure portal_passcode and portal_active columns exist (idempotent)
-- and update get_portal_client to always include custom passcode in key check

alter table public.clients add column if not exists portal_active boolean not null default true;
alter table public.clients add column if not exists portal_passcode text;

-- Recreate get_portal_client with unified passcode logic:
-- 1. If client has a custom portal_passcode saved in DB -> use that
-- 2. Otherwise fall back to JV-XXX-YY auto-generated code
-- This is the single source of truth for BOTH admin and public portals.
create or replace function public.get_portal_client(client_id uuid, client_key text)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  c record;
  org record;
  expected_key text;
  jobs_json json;
  cleaners_json json;
  evidence_json json;
  signatures_json json;
begin
  -- Fetch client
  select * into c 
  from public.clients 
  where id = client_id;
  
  if not found then
    return null;
  end if;

  -- If portal is disabled, deny access
  if c.portal_active = false then
    return null;
  end if;

  -- Unified passcode: custom if set, else auto-generated
  if c.portal_passcode is not null and trim(c.portal_passcode) != '' then
    expected_key := upper(trim(c.portal_passcode));
  else
    expected_key := upper(trim('JV-' || upper(substring(c.name from 1 for 3)) || '-' || right(c.id::text, 2)));
  end if;

  -- Compare keys (case-insensitive and trimmed). Allow master key for admin bypass.
  if upper(trim(client_key)) != expected_key and client_key != 'ADMIN_MASTER_KEY' then
    return null;
  end if;

  -- Fetch organization details
  select * into org
  from public.organizations
  where id = c.organization_id;

  -- Fetch jobs for this client
  select json_agg(j) into jobs_json 
  from public.jobs j 
  where j.client_id = client_id;

  -- Fetch cleaners for the organization to display assignment info
  select json_agg(cl) into cleaners_json
  from public.cleaners cl
  where cl.organization_id = c.organization_id;

  -- Fetch job evidence for jobs related to this client
  select json_agg(ev) into evidence_json
  from public.job_evidence ev
  join public.jobs j on ev.job_id = j.id
  where j.client_id = client_id;

  -- Fetch signatures for jobs related to this client
  select json_agg(sig) into signatures_json
  from public.client_signatures sig
  join public.jobs j on sig.job_id = j.id
  where j.client_id = client_id;

  return json_build_object(
    'client', row_to_json(c),
    'organization', row_to_json(org),
    'jobs', coalesce(jobs_json, '[]'::json),
    'cleaners', coalesce(cleaners_json, '[]'::json),
    'evidence', coalesce(evidence_json, '[]'::json),
    'signatures', coalesce(signatures_json, '[]'::json)
  );
end;
$$;

-- Refresh schema cache
notify pgrst, 'reload schema';
