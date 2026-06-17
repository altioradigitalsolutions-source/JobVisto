-- Fix portal RPCs that failed in production because parameter names collided with
-- column names, and align cleaner assignment status with the admin workflow.

create or replace function public.portal_cleaner_take_job(
  cleaner_id uuid,
  cleaner_key text,
  job_id uuid,
  assigned_cleaner_id uuid default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
<<fn>>
declare
  c public.cleaners;
  v_cleaner_id uuid := $1;
  v_cleaner_key text := $2;
  v_job_id uuid := $3;
begin
  select * into c from public.cleaners cln where cln.id = v_cleaner_id;
  if not found or not public.portal_cleaner_key_matches(c, v_cleaner_key) then
    raise exception 'invalid cleaner portal access';
  end if;

  update public.jobs j
  set assigned_cleaner_id = c.id,
      status = 'assigned',
      updated_at = now()
  where j.id = v_job_id
    and j.organization_id = c.organization_id
    and (j.assigned_cleaner_id is null or j.assigned_cleaner_id = c.id);

  if not found then
    raise exception 'job not available for cleaner';
  end if;
end;
$$;

create or replace function public.portal_cleaner_mark_arrived(
  cleaner_id uuid,
  cleaner_key text,
  job_id uuid,
  p_actual_start timestamptz,
  p_lat numeric default null,
  p_lng numeric default null,
  p_accuracy numeric default null,
  p_location_at timestamptz default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
<<fn>>
declare
  c public.cleaners;
  v_cleaner_id uuid := $1;
  v_cleaner_key text := $2;
  v_job_id uuid := $3;
  v_actual_start timestamptz := $4;
  v_lat numeric := $5;
  v_lng numeric := $6;
  v_accuracy numeric := $7;
  v_location_at timestamptz := $8;
begin
  select * into c from public.cleaners cln where cln.id = v_cleaner_id;
  if not found or not public.portal_cleaner_key_matches(c, v_cleaner_key) then
    raise exception 'invalid cleaner portal access';
  end if;

  update public.jobs j
  set assigned_cleaner_id = c.id,
      status = 'in_site',
      actual_start = coalesce(v_actual_start, now()),
      cleaner_lat = v_lat,
      cleaner_lng = v_lng,
      cleaner_location_accuracy = v_accuracy,
      cleaner_location_at = coalesce(v_location_at, now()),
      updated_at = now()
  where j.id = v_job_id
    and j.organization_id = c.organization_id
    and (j.assigned_cleaner_id = c.id or j.assigned_cleaner_id is null);

  if not found then
    raise exception 'job not available for cleaner';
  end if;
end;
$$;

create or replace function public.portal_cleaner_finish_job(
  cleaner_id uuid,
  cleaner_key text,
  job_id uuid,
  p_actual_end timestamptz
)
returns void
language plpgsql
security definer
set search_path = public
as $$
<<fn>>
declare
  c public.cleaners;
  v_cleaner_id uuid := $1;
  v_cleaner_key text := $2;
  v_job_id uuid := $3;
  v_actual_end timestamptz := $4;
begin
  select * into c from public.cleaners cln where cln.id = v_cleaner_id;
  if not found or not public.portal_cleaner_key_matches(c, v_cleaner_key) then
    raise exception 'invalid cleaner portal access';
  end if;

  update public.jobs j
  set status = 'cleaner_finished',
      actual_end = coalesce(v_actual_end, now()),
      updated_at = now()
  where j.id = v_job_id
    and j.organization_id = c.organization_id
    and j.assigned_cleaner_id = c.id;

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
  p_phase evidence_phase,
  p_file_path text,
  p_caption text default ''
)
returns void
language plpgsql
security definer
set search_path = public
as $$
<<fn>>
declare
  c public.cleaners;
  j public.jobs;
  v_cleaner_id uuid := $1;
  v_cleaner_key text := $2;
  v_evidence_id uuid := $3;
  v_job_id uuid := $4;
  v_area text := $5;
  v_phase evidence_phase := $6;
  v_file_path text := $7;
  v_caption text := $8;
begin
  select * into c from public.cleaners cln where cln.id = v_cleaner_id;
  if not found or not public.portal_cleaner_key_matches(c, v_cleaner_key) then
    raise exception 'invalid cleaner portal access';
  end if;

  select * into j
  from public.jobs job
  where job.id = v_job_id
    and job.organization_id = c.organization_id
    and (job.assigned_cleaner_id = c.id or job.assigned_cleaner_id is null or job.status = 'open');

  if not found then
    raise exception 'job not available for cleaner';
  end if;

  insert into public.job_evidence (id, organization_id, job_id, uploaded_by_cleaner_id, area, phase, file_path, caption)
  values (
    v_evidence_id,
    c.organization_id,
    j.id,
    c.id,
    coalesce(nullif(v_area, ''), 'General'),
    v_phase,
    v_file_path,
    coalesce(v_caption, '')
  )
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
<<fn>>
declare
  c public.cleaners;
  j public.jobs;
  v_cleaner_id uuid := $1;
  v_cleaner_key text := $2;
  v_job_id uuid := $3;
  v_signer_name text := $4;
  v_signature_data text := $5;
begin
  select * into c from public.cleaners cln where cln.id = v_cleaner_id;
  if not found or not public.portal_cleaner_key_matches(c, v_cleaner_key) then
    raise exception 'invalid cleaner portal access';
  end if;

  select * into j
  from public.jobs job
  where job.id = v_job_id
    and job.organization_id = c.organization_id
    and job.assigned_cleaner_id = c.id;

  if not found then
    raise exception 'job not available for cleaner';
  end if;

  delete from public.client_signatures sig
  where sig.job_id = j.id
    and sig.signed_from = 'cleaner_device';

  insert into public.client_signatures (organization_id, job_id, signer_name, signature_data, signed_from)
  values (
    c.organization_id,
    j.id,
    coalesce(nullif(v_signer_name, ''), 'Persona en sitio'),
    v_signature_data,
    'cleaner_device'
  );
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
<<fn>>
declare
  c public.cleaners;
  v_cleaner_id uuid := $1;
  v_cleaner_key text := $2;
  v_receipt_id uuid := $3;
  v_receiver_name text := $4;
  v_signature_data text := $5;
begin
  select * into c from public.cleaners cln where cln.id = v_cleaner_id;
  if not found or not public.portal_cleaner_key_matches(c, v_cleaner_key) then
    raise exception 'invalid cleaner portal access';
  end if;

  update public.payment_receipts r
  set receiver_name = coalesce(nullif(v_receiver_name, ''), c.name),
      receiver_signature_data = v_signature_data,
      status = 'signed',
      updated_at = now()
  where r.id = v_receipt_id
    and r.organization_id = c.organization_id
    and r.cleaner_id = c.id;

  if not found then
    raise exception 'receipt not available for cleaner';
  end if;
end;
$$;

create or replace function public.portal_client_confirm_job(
  client_id uuid,
  client_key text,
  job_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
<<fn>>
declare
  c public.clients;
  j public.jobs;
  v_client_id uuid := $1;
  v_client_key text := $2;
  v_job_id uuid := $3;
begin
  select * into c from public.clients cl where cl.id = v_client_id;
  if not found or not public.portal_client_key_matches(c, v_client_key) then
    raise exception 'invalid client portal access';
  end if;

  select * into j
  from public.jobs job
  where job.id = v_job_id
    and job.client_id = c.id
    and job.organization_id = c.organization_id;

  if not found then
    raise exception 'job not available for client';
  end if;

  update public.jobs job
  set status = 'client_confirmed',
      updated_at = now()
  where job.id = j.id;

  delete from public.client_signatures sig
  where sig.job_id = j.id
    and sig.signed_from = 'private_link';

  insert into public.client_signatures (organization_id, job_id, signer_name, signature_data, signed_from)
  values (c.organization_id, j.id, c.name, 'Confirmado via portal seguro', 'private_link');
end;
$$;

create or replace function public.portal_client_review_job(
  client_id uuid,
  client_key text,
  job_id uuid,
  p_rating integer,
  p_review_text text default ''
)
returns void
language plpgsql
security definer
set search_path = public
as $$
<<fn>>
declare
  c public.clients;
  j public.jobs;
  v_client_id uuid := $1;
  v_client_key text := $2;
  v_job_id uuid := $3;
  v_rating integer := $4;
  v_review_text text := $5;
begin
  if v_rating is null or v_rating < 1 or v_rating > 5 then
    raise exception 'rating must be between 1 and 5';
  end if;

  select * into c
  from public.clients cl
  where cl.id = v_client_id;

  if not found or not public.portal_client_key_matches(c, v_client_key) then
    raise exception 'invalid client portal access';
  end if;

  select * into j
  from public.jobs job
  where job.id = v_job_id
    and job.client_id = c.id
    and job.organization_id = c.organization_id;

  if not found then
    raise exception 'job not available for client';
  end if;

  if coalesce(j.request_review, false) = false then
    raise exception 'review was not requested for this job';
  end if;

  update public.jobs job
  set client_rating = v_rating,
      client_review_text = nullif(trim(coalesce(v_review_text, '')), ''),
      updated_at = now()
  where job.id = j.id;
end;
$$;

do $$
declare
  fn_oid oid;
  fn_sql text;
  location_fields text := '
              ''cleaner_on_way_at'', j.cleaner_on_way_at,
              ''cleaner_lat'', j.cleaner_lat,
              ''cleaner_lng'', j.cleaner_lng,
              ''cleaner_location_accuracy'', j.cleaner_location_accuracy,
              ''cleaner_location_at'', j.cleaner_location_at,';
begin
  select p.oid
    into fn_oid
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname = 'get_portal_client'
     and pg_get_function_arguments(p.oid) = 'client_id uuid, client_key text';

  if fn_oid is not null then
    fn_sql := pg_get_functiondef(fn_oid);
    if position('''cleaner_on_way_at''' in fn_sql) = 0 then
      fn_sql := replace(
        fn_sql,
        '''client_payment_method'', j.client_payment_method,
    ''status'', j.status,',
        '''client_payment_method'', j.client_payment_method,' || location_fields || '
    ''status'', j.status,'
      );
      execute fn_sql;
    end if;
  end if;

  select p.oid
    into fn_oid
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname = 'get_portal_cleaner'
     and pg_get_function_arguments(p.oid) = 'cleaner_id uuid, cleaner_key text';

  if fn_oid is not null then
    fn_sql := pg_get_functiondef(fn_oid);
    if position('''cleaner_on_way_at''' in fn_sql) = 0 then
      fn_sql := replace(
        fn_sql,
        '''client_payment_method'', j.client_payment_method,
    ''status'', j.status,',
        '''client_payment_method'', j.client_payment_method,' || location_fields || '
    ''status'', j.status,'
      );
      execute fn_sql;
    end if;
  end if;
end $$;

grant execute on function public.portal_cleaner_take_job(uuid, text, uuid, uuid) to anon, authenticated;
grant execute on function public.portal_cleaner_mark_arrived(uuid, text, uuid, timestamptz, numeric, numeric, numeric, timestamptz) to anon, authenticated;
grant execute on function public.portal_cleaner_finish_job(uuid, text, uuid, timestamptz) to anon, authenticated;
grant execute on function public.portal_cleaner_save_evidence(uuid, text, uuid, uuid, text, evidence_phase, text, text) to anon, authenticated;
grant execute on function public.portal_cleaner_save_site_signature(uuid, text, uuid, text, text) to anon, authenticated;
grant execute on function public.portal_cleaner_sign_receipt(uuid, text, uuid, text, text) to anon, authenticated;
grant execute on function public.portal_client_confirm_job(uuid, text, uuid) to anon, authenticated;
grant execute on function public.portal_client_review_job(uuid, text, uuid, integer, text) to anon, authenticated;
grant execute on function public.get_portal_client(uuid, text) to anon, authenticated;
grant execute on function public.get_portal_cleaner(uuid, text) to anon, authenticated;
