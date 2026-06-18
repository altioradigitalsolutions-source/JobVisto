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
declare
  c public.cleaners;
  v_cleaner_id uuid := $1;
  v_cleaner_key text := $2;
  v_job_id uuid := $3;
begin
  select * into c
  from public.cleaners cln
  where cln.id = v_cleaner_id;

  if not found
     or coalesce(c.archived, false) = true
     or not public.portal_cleaner_key_matches(c, v_cleaner_key) then
    raise exception 'invalid cleaner portal access';
  end if;

  update public.jobs j
  set assigned_cleaner_id = c.id,
      status = 'assigned',
      updated_at = now()
  where j.id = v_job_id
    and j.organization_id = c.organization_id
    and (j.assigned_cleaner_id is null or j.assigned_cleaner_id = c.id)
    and j.status in ('open', 'scheduled', 'assigned');

  if not found then
    raise exception 'job not available for cleaner';
  end if;
end;
$$;

grant execute on function public.portal_cleaner_take_job(uuid, text, uuid, uuid) to anon, authenticated;
