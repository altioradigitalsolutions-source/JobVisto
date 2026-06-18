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
  settings_json json;
  v_cleaner_id uuid := $1;
  v_cleaner_key text := $2;
begin
  if nullif(trim(coalesce(v_cleaner_key, '')), '') is null then
    return null;
  end if;

  select * into c
  from public.cleaners cln
  where cln.id = v_cleaner_id
    and cln.archived = false
    and public.portal_cleaner_key_matches(cln, v_cleaner_key);

  if not found then
    return null;
  end if;

  select * into org from public.organizations o where o.id = c.organization_id;

  select json_agg(j) into jobs_json
  from public.jobs j
  where j.organization_id = c.organization_id
    and (j.assigned_cleaner_id = v_cleaner_id or j.status = 'open');

  select json_agg(r) into receipts_json
  from public.payment_receipts r
  where r.cleaner_id = v_cleaner_id;

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

  select json_agg(json_build_object(
    'key', s.key,
    'value', s.value
  )) into settings_json
  from public.organization_settings s
  where s.organization_id = c.organization_id
    and s.key in ('vat_rate', 'currency_symbol');

  return json_build_object(
    'cleaner', row_to_json(c),
    'organization', row_to_json(org),
    'settings', coalesce(settings_json, '[]'::json),
    'jobs', coalesce(jobs_json, '[]'::json),
    'receipts', coalesce(receipts_json, '[]'::json),
    'clients', coalesce(clients_json, '[]'::json),
    'evidence', coalesce(evidence_json, '[]'::json),
    'signatures', coalesce(signatures_json, '[]'::json)
  );
end;
$$;

grant execute on function public.get_portal_cleaner(uuid, text) to anon, authenticated;
