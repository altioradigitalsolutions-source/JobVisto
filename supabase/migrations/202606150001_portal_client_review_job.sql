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
declare
  c public.clients;
  j public.jobs;
begin
  if p_rating is null or p_rating < 1 or p_rating > 5 then
    raise exception 'rating must be between 1 and 5';
  end if;

  select * into c
  from public.clients
  where id = client_id;

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

  if coalesce(j.request_review, false) = false then
    raise exception 'review was not requested for this job';
  end if;

  update public.jobs
  set client_rating = p_rating,
      client_review_text = nullif(trim(coalesce(p_review_text, '')), ''),
      updated_at = now()
  where id = j.id;
end;
$$;

grant execute on function public.portal_client_review_job(uuid, text, uuid, integer, text) to anon, authenticated;

notify pgrst, 'reload schema';
