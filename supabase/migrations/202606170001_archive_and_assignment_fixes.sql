-- Persist archive state and make cleaner job claiming truly assigned.

alter table public.clients add column if not exists archived boolean not null default false;
alter table public.clients add column if not exists archived_at timestamptz;

alter table public.cleaners add column if not exists archived boolean not null default false;
alter table public.cleaners add column if not exists archived_at timestamptz;

create or replace function public.portal_cleaner_take_job(cleaner_id uuid, cleaner_key text, job_id uuid, assigned_cleaner_id uuid default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  c public.cleaners;
begin
  select * into c from public.cleaners where id = cleaner_id;
  if not found or c.archived = true or not public.portal_cleaner_key_matches(c, cleaner_key) then
    raise exception 'invalid cleaner portal access';
  end if;

  update public.jobs
  set assigned_cleaner_id = c.id,
      status = 'assigned',
      updated_at = now()
  where id = job_id
    and organization_id = c.organization_id
    and (assigned_cleaner_id is null or assigned_cleaner_id = c.id)
    and status in ('open', 'scheduled', 'assigned');

  if not found then
    raise exception 'job not available for cleaner';
  end if;
end;
$$;

create or replace function public.get_portal_cleaner(cleaner_id uuid, cleaner_key text)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  c record;
  org record;
  jobs_json json;
  receipts_json json;
  clients_json json;
  evidence_json json;
  signatures_json json;
begin
  select * into c
  from public.cleaners
  where id = cleaner_id
    and archived = false
    and upper(trim(access_key)) = upper(trim(cleaner_key));

  if not found then
    return null;
  end if;

  select * into org from public.organizations where id = c.organization_id;

  select json_agg(j) into jobs_json
  from public.jobs j
  where j.organization_id = c.organization_id
    and (j.assigned_cleaner_id = cleaner_id or j.status = 'open');

  select json_agg(r) into receipts_json
  from public.payment_receipts r
  where r.cleaner_id = cleaner_id;

  select json_agg(cl) into clients_json
  from public.clients cl
  where cl.organization_id = c.organization_id
    and cl.archived = false;

  select json_agg(ev) into evidence_json
  from public.job_evidence ev
  where ev.organization_id = c.organization_id;

  select json_agg(sig) into signatures_json
  from public.client_signatures sig
  where sig.organization_id = c.organization_id;

  return json_build_object(
    'cleaner', row_to_json(c),
    'organization', row_to_json(org),
    'jobs', coalesce(jobs_json, '[]'::json),
    'receipts', coalesce(receipts_json, '[]'::json),
    'clients', coalesce(clients_json, '[]'::json),
    'evidence', coalesce(evidence_json, '[]'::json),
    'signatures', coalesce(signatures_json, '[]'::json)
  );
end;
$$;

grant execute on function public.portal_cleaner_take_job(uuid, text, uuid, uuid) to anon, authenticated;
grant execute on function public.get_portal_cleaner(uuid, text) to anon, authenticated;

create or replace function public.portal_client_key_matches(c public.clients, client_key text)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  expected_key text;
begin
  if c.archived = true or c.portal_active = false then
    return false;
  end if;

  if c.portal_passcode is not null and trim(c.portal_passcode) != '' then
    expected_key := upper(trim(c.portal_passcode));
  else
    expected_key := upper(trim('JV-' || upper(substring(c.name from 1 for 3)) || '-' || right(c.id::text, 2)));
  end if;

  return upper(trim(coalesce(client_key, ''))) = expected_key;
end;
$$;

grant execute on function public.portal_client_key_matches(public.clients, text) to anon, authenticated;
