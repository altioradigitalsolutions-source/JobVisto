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

  update public.jobs job
  set client_rating = v_rating,
      client_review_text = nullif(trim(coalesce(v_review_text, '')), ''),
      request_review = true,
      updated_at = now()
  where job.id = j.id;
end;
$$;

grant execute on function public.portal_client_review_job(uuid, text, uuid, integer, text) to anon, authenticated;
