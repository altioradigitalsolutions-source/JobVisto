alter table public.jobs add column if not exists cleaner_quality_rating integer;
alter table public.jobs add column if not exists cleaner_punctuality_rating integer;
alter table public.jobs add column if not exists cleaner_professionalism_rating integer;
alter table public.jobs add column if not exists cleaner_quality_text text;
alter table public.jobs add column if not exists cleaner_recommended boolean;

create or replace function public.portal_client_review_job(
  client_id uuid,
  client_key text,
  job_id uuid,
  p_rating integer,
  p_review_text text default '',
  p_cleaner_quality_rating integer default null,
  p_cleaner_punctuality_rating integer default null,
  p_cleaner_professionalism_rating integer default null,
  p_cleaner_quality_text text default '',
  p_cleaner_recommended boolean default null
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
      client_review_text = nullif(trim(coalesce(p_review_text, '')), ''),
      cleaner_quality_rating = case when p_cleaner_quality_rating between 1 and 5 then p_cleaner_quality_rating else null end,
      cleaner_punctuality_rating = case when p_cleaner_punctuality_rating between 1 and 5 then p_cleaner_punctuality_rating else null end,
      cleaner_professionalism_rating = case when p_cleaner_professionalism_rating between 1 and 5 then p_cleaner_professionalism_rating else null end,
      cleaner_quality_text = nullif(trim(coalesce(p_cleaner_quality_text, '')), ''),
      cleaner_recommended = p_cleaner_recommended,
      request_review = true,
      updated_at = now()
  where job.id = j.id;
end;
$$;

grant execute on function public.portal_client_review_job(uuid, text, uuid, integer, text, integer, integer, integer, text, boolean) to anon, authenticated;
