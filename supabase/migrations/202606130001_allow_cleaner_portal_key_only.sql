create or replace function public.get_portal_cleaner(cleaner_id uuid, cleaner_key text)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  c public.cleaners;
  org public.organizations;
  jobs_json json;
  receipts_json json;
  clients_json json;
  evidence_json json;
  signatures_json json;
  settings_json json;
begin
  if nullif(trim(coalesce(cleaner_key, '')), '') is null then
    return null;
  end if;

  select * into c
  from public.cleaners cln
  where (cleaner_id is null or cln.id = cleaner_id)
    and upper(trim(cln.access_key)) = upper(trim(cleaner_key))
  order by cln.created_at desc
  limit 1;

  if not found then
    return null;
  end if;

  select * into org
  from public.organizations o
  where o.id = c.organization_id;

  select json_agg(json_build_object(
    'id', j.id,
    'organization_id', j.organization_id,
    'client_id', j.client_id,
    'assigned_cleaner_id', j.assigned_cleaner_id,
    'service_type', j.service_type,
    'scheduled_start', j.scheduled_start,
    'scheduled_end', j.scheduled_end,
    'actual_start', j.actual_start,
    'actual_end', j.actual_end,
    'client_hourly_rate', j.client_hourly_rate,
    'extras_amount', j.extras_amount,
    'request_review', j.request_review,
    'client_rating', j.client_rating,
    'client_review_text', j.client_review_text,
    'client_paid_amount', j.client_paid_amount,
    'client_payment_status', j.client_payment_status,
    'client_paid_date', j.client_paid_date,
    'client_payment_method', j.client_payment_method,
    'status', j.status,
    'checklist', j.checklist
  )) into jobs_json
  from public.jobs j
  where j.organization_id = c.organization_id
    and (j.assigned_cleaner_id = c.id or j.status = 'open');

  select json_agg(json_build_object(
    'id', r.id,
    'organization_id', r.organization_id,
    'cleaner_id', r.cleaner_id,
    'period_start', r.period_start,
    'period_end', r.period_end,
    'amount', r.amount,
    'currency', r.currency,
    'payment_method', r.payment_method,
    'paid_at', r.paid_at,
    'receiver_name', r.receiver_name,
    'receiver_signature_data', r.receiver_signature_data,
    'status', r.status
  )) into receipts_json
  from public.payment_receipts r
  where r.cleaner_id = c.id;

  select json_agg(json_build_object(
    'id', cl.id,
    'organization_id', cl.organization_id,
    'name', cl.name,
    'phone', cl.phone,
    'email', cl.email,
    'preferred_language', cl.preferred_language,
    'default_payment_method', cl.default_payment_method,
    'notes', cl.notes,
    'address', ca.address_line,
    'country', ca.country,
    'city', ca.city,
    'region', ca.region
  )) into clients_json
  from public.clients cl
  left join public.client_addresses ca on ca.client_id = cl.id
  where cl.organization_id = c.organization_id;

  select json_agg(json_build_object(
    'id', ev.id,
    'organization_id', ev.organization_id,
    'job_id', ev.job_id,
    'uploaded_by_cleaner_id', ev.uploaded_by_cleaner_id,
    'area', ev.area,
    'phase', ev.phase,
    'file_path', ev.file_path,
    'thumbnail_path', ev.thumbnail_path,
    'caption', ev.caption,
    'created_at', ev.created_at
  )) into evidence_json
  from public.job_evidence ev
  join public.jobs j on j.id = ev.job_id
  where ev.organization_id = c.organization_id
    and (j.assigned_cleaner_id = c.id or j.status = 'open');

  select json_agg(json_build_object(
    'id', sig.id,
    'organization_id', sig.organization_id,
    'job_id', sig.job_id,
    'signer_name', sig.signer_name,
    'signature_data', sig.signature_data,
    'confirmation_text', sig.confirmation_text,
    'signed_at', sig.signed_at,
    'signed_from', sig.signed_from
  )) into signatures_json
  from public.client_signatures sig
  join public.jobs j on j.id = sig.job_id
  where sig.organization_id = c.organization_id
    and (j.assigned_cleaner_id = c.id or j.status = 'open');

  select json_agg(json_build_object(
    'key', s.key,
    'value', s.value
  )) into settings_json
  from public.organization_settings s
  where s.organization_id = c.organization_id
    and s.key in ('vat_rate', 'currency_symbol');

  return json_build_object(
    'cleaner', json_build_object(
      'id', c.id,
      'organization_id', c.organization_id,
      'name', c.name,
      'phone', c.phone,
      'email', c.email,
      'status', c.status,
      'country', c.country,
      'region', c.region,
      'city', c.city,
      'language', c.language
    ),
    'organization', json_build_object(
      'id', org.id,
      'name', org.name,
      'type', org.type,
      'country', org.country,
      'currency', org.currency,
      'default_language', org.default_language
    ),
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
