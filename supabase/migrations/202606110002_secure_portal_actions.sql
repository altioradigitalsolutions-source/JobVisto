-- Secure portal write actions behind passcode-validated RPCs.

drop policy if exists "portal public signatures manage" on public.client_signatures;
drop policy if exists "portal public receipts update" on public.payment_receipts;
drop policy if exists "portal public evidence manage" on public.job_evidence;
drop policy if exists "portal public jobs update" on public.jobs;

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
  where cl.organization_id = c.organization_id;

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
  if c.portal_active = false then
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

create or replace function public.portal_cleaner_key_matches(c public.cleaners, cleaner_key text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select upper(trim(coalesce(c.access_key, ''))) = upper(trim(coalesce(cleaner_key, '')));
$$;

create or replace function public.get_portal_client(client_id uuid, client_key text)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  c public.clients;
  org record;
  jobs_json json;
  cleaners_json json;
  evidence_json json;
  signatures_json json;
begin
  select * into c from public.clients where id = client_id;

  if not found or not public.portal_client_key_matches(c, client_key) then
    return null;
  end if;

  select * into org from public.organizations where id = c.organization_id;

  select json_agg(j) into jobs_json
  from public.jobs j
  where j.client_id = client_id;

  select json_agg(cl) into cleaners_json
  from public.cleaners cl
  where cl.organization_id = c.organization_id;

  select json_agg(ev) into evidence_json
  from public.job_evidence ev
  join public.jobs j on ev.job_id = j.id
  where j.client_id = client_id;

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
  if not found or not public.portal_cleaner_key_matches(c, cleaner_key) then
    raise exception 'invalid cleaner portal access';
  end if;

  update public.jobs
  set assigned_cleaner_id = c.id,
      status = 'scheduled',
      updated_at = now()
  where id = job_id
    and organization_id = c.organization_id
    and (assigned_cleaner_id = c.id or assigned_cleaner_id is null or status = 'open');

  if not found then
    raise exception 'job not available for cleaner';
  end if;
end;
$$;

create or replace function public.portal_cleaner_mark_arrived(cleaner_id uuid, cleaner_key text, job_id uuid, p_actual_start timestamptz)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  c public.cleaners;
begin
  select * into c from public.cleaners where id = cleaner_id;
  if not found or not public.portal_cleaner_key_matches(c, cleaner_key) then
    raise exception 'invalid cleaner portal access';
  end if;

  update public.jobs
  set assigned_cleaner_id = c.id,
      status = 'in_site',
      actual_start = coalesce(p_actual_start, now()),
      updated_at = now()
  where id = job_id
    and organization_id = c.organization_id
    and (assigned_cleaner_id = c.id or assigned_cleaner_id is null);

  if not found then
    raise exception 'job not available for cleaner';
  end if;
end;
$$;

create or replace function public.portal_cleaner_finish_job(cleaner_id uuid, cleaner_key text, job_id uuid, p_actual_end timestamptz)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  c public.cleaners;
begin
  select * into c from public.cleaners where id = cleaner_id;
  if not found or not public.portal_cleaner_key_matches(c, cleaner_key) then
    raise exception 'invalid cleaner portal access';
  end if;

  update public.jobs
  set status = 'cleaner_finished',
      actual_end = coalesce(p_actual_end, now()),
      updated_at = now()
  where id = job_id
    and organization_id = c.organization_id
    and assigned_cleaner_id = c.id;

  if not found then
    raise exception 'job not available for cleaner';
  end if;
end;
$$;

create or replace function public.portal_cleaner_save_evidence(
  cleaner_id uuid,
  cleaner_key text,
  evidence_id uuid,
  job_id uuid,
  p_area text,
  p_phase public.evidence_phase,
  p_file_path text,
  p_caption text default ''
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  c public.cleaners;
  j public.jobs;
begin
  select * into c from public.cleaners where id = cleaner_id;
  if not found or not public.portal_cleaner_key_matches(c, cleaner_key) then
    raise exception 'invalid cleaner portal access';
  end if;

  select * into j
  from public.jobs
  where id = job_id
    and organization_id = c.organization_id
    and (assigned_cleaner_id = c.id or assigned_cleaner_id is null or status = 'open');

  if not found then
    raise exception 'job not available for cleaner';
  end if;

  insert into public.job_evidence (id, organization_id, job_id, uploaded_by_cleaner_id, area, phase, file_path, caption)
  values (evidence_id, c.organization_id, j.id, c.id, coalesce(nullif(p_area, ''), 'General'), p_phase, p_file_path, coalesce(p_caption, ''))
  on conflict (id) do update set
    area = excluded.area,
    phase = excluded.phase,
    file_path = excluded.file_path,
    caption = excluded.caption;
end;
$$;

create or replace function public.portal_cleaner_save_site_signature(
  cleaner_id uuid,
  cleaner_key text,
  job_id uuid,
  p_signer_name text,
  p_signature_data text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  c public.cleaners;
  j public.jobs;
begin
  select * into c from public.cleaners where id = cleaner_id;
  if not found or not public.portal_cleaner_key_matches(c, cleaner_key) then
    raise exception 'invalid cleaner portal access';
  end if;

  select * into j
  from public.jobs
  where id = job_id
    and organization_id = c.organization_id
    and assigned_cleaner_id = c.id;

  if not found then
    raise exception 'job not available for cleaner';
  end if;

  delete from public.client_signatures where job_id = j.id and signed_from = 'cleaner_device';
  insert into public.client_signatures (organization_id, job_id, signer_name, signature_data, signed_from)
  values (c.organization_id, j.id, coalesce(nullif(p_signer_name, ''), 'Persona en sitio'), p_signature_data, 'cleaner_device');
end;
$$;

create or replace function public.portal_cleaner_sign_receipt(
  cleaner_id uuid,
  cleaner_key text,
  receipt_id uuid,
  p_receiver_name text,
  p_signature_data text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  c public.cleaners;
begin
  select * into c from public.cleaners where id = cleaner_id;
  if not found or not public.portal_cleaner_key_matches(c, cleaner_key) then
    raise exception 'invalid cleaner portal access';
  end if;

  update public.payment_receipts
  set receiver_name = coalesce(nullif(p_receiver_name, ''), c.name),
      receiver_signature_data = p_signature_data,
      status = 'signed',
      updated_at = now()
  where id = receipt_id
    and organization_id = c.organization_id
    and cleaner_id = c.id;

  if not found then
    raise exception 'receipt not available for cleaner';
  end if;
end;
$$;

create or replace function public.portal_client_confirm_job(client_id uuid, client_key text, job_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  c public.clients;
  j public.jobs;
begin
  select * into c from public.clients where id = client_id;
  if not found or not public.portal_client_key_matches(c, client_key) then
    raise exception 'invalid client portal access';
  end if;

  select * into j
  from public.jobs
  where id = job_id
    and client_id = c.id
    and organization_id = c.organization_id;

  if not found then
    raise exception 'job not available for client';
  end if;

  update public.jobs
  set status = 'client_confirmed',
      updated_at = now()
  where id = j.id;

  delete from public.client_signatures where job_id = j.id and signed_from = 'private_link';
  insert into public.client_signatures (organization_id, job_id, signer_name, signature_data, signed_from)
  values (c.organization_id, j.id, c.name, 'Confirmado via portal seguro', 'private_link');
end;
$$;

grant execute on function public.portal_cleaner_take_job(uuid, text, uuid, uuid) to anon, authenticated;
grant execute on function public.portal_cleaner_mark_arrived(uuid, text, uuid, timestamptz) to anon, authenticated;
grant execute on function public.portal_cleaner_finish_job(uuid, text, uuid, timestamptz) to anon, authenticated;
grant execute on function public.portal_cleaner_save_evidence(uuid, text, uuid, uuid, text, public.evidence_phase, text, text) to anon, authenticated;
grant execute on function public.portal_cleaner_save_site_signature(uuid, text, uuid, text, text) to anon, authenticated;
grant execute on function public.portal_cleaner_sign_receipt(uuid, text, uuid, text, text) to anon, authenticated;
grant execute on function public.portal_client_confirm_job(uuid, text, uuid) to anon, authenticated;

notify pgrst, 'reload schema';
