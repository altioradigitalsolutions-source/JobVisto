-- Fix portal RPC ambiguity, avoid sensitive-field leaks, and support single-address upserts.

-- The app stores one primary address per client. Keep the newest address when
-- older duplicate rows exist, then make the app's onConflict: client_id valid.
with ranked_addresses as (
  select
    id,
    first_value(id) over (
      partition by client_id
      order by updated_at desc nulls last, created_at desc nulls last, id desc
    ) as keep_id,
    row_number() over (
      partition by client_id
      order by updated_at desc nulls last, created_at desc nulls last, id desc
    ) as rn
  from public.client_addresses
)
update public.jobs j
set address_id = ra.keep_id
from ranked_addresses ra
where j.address_id = ra.id
  and ra.rn > 1;

with ranked_addresses as (
  select
    id,
    row_number() over (
      partition by client_id
      order by updated_at desc nulls last, created_at desc nulls last, id desc
    ) as rn
  from public.client_addresses
)
delete from public.client_addresses ca
using ranked_addresses ra
where ca.id = ra.id
  and ra.rn > 1;

create unique index if not exists client_addresses_client_id_key
  on public.client_addresses(client_id);

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
  select * into c
  from public.cleaners cln
  where cln.id = $1
    and upper(trim(cln.access_key)) = upper(trim($2));

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
    and (j.assigned_cleaner_id = $1 or j.status = 'open');

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
  where r.cleaner_id = $1;

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
    and (j.assigned_cleaner_id = $1 or j.status = 'open');

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
    and (j.assigned_cleaner_id = $1 or j.status = 'open');

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

create or replace function public.get_portal_client(client_id uuid, client_key text)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  c public.clients;
  org public.organizations;
  jobs_json json;
  cleaners_json json;
  evidence_json json;
  signatures_json json;
  addresses_json json;
  settings_json json;
begin
  select * into c
  from public.clients cl
  where cl.id = $1;

  if not found or not public.portal_client_key_matches(c, $2) then
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
  where j.client_id = $1;

  select json_agg(json_build_object(
    'id', cln.id,
    'organization_id', cln.organization_id,
    'name', cln.name,
    'phone', cln.phone,
    'email', cln.email,
    'status', cln.status,
    'country', cln.country,
    'region', cln.region,
    'city', cln.city,
    'language', cln.language
  )) into cleaners_json
  from public.cleaners cln
  where cln.organization_id = c.organization_id;

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
  join public.jobs j on ev.job_id = j.id
  where j.client_id = $1;

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
  join public.jobs j on sig.job_id = j.id
  where j.client_id = $1;

  select json_agg(json_build_object(
    'id', ca.id,
    'client_id', ca.client_id,
    'address_line', ca.address_line,
    'country', ca.country,
    'region', ca.region,
    'city', ca.city,
    'latitude', ca.latitude,
    'longitude', ca.longitude
  )) into addresses_json
  from public.client_addresses ca
  where ca.client_id = $1;

  select json_agg(json_build_object(
    'key', s.key,
    'value', s.value
  )) into settings_json
  from public.organization_settings s
  where s.organization_id = c.organization_id
    and s.key in ('vat_rate', 'currency_symbol');

  return json_build_object(
    'client', json_build_object(
      'id', c.id,
      'organization_id', c.organization_id,
      'name', c.name,
      'phone', c.phone,
      'email', c.email,
      'preferred_language', c.preferred_language,
      'default_payment_method', c.default_payment_method,
      'notes', c.notes,
      'portal_active', c.portal_active
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
    'addresses', coalesce(addresses_json, '[]'::json),
    'jobs', coalesce(jobs_json, '[]'::json),
    'cleaners', coalesce(cleaners_json, '[]'::json),
    'evidence', coalesce(evidence_json, '[]'::json),
    'signatures', coalesce(signatures_json, '[]'::json)
  );
end;
$$;

grant execute on function public.get_portal_client(uuid, text) to anon, authenticated;
grant execute on function public.get_portal_cleaner(uuid, text) to anon, authenticated;

notify pgrst, 'reload schema';
