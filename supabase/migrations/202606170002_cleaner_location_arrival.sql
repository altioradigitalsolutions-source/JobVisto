-- Store cleaner arrival location and expose it through the secure portal action.

alter table public.jobs add column if not exists cleaner_on_way_at timestamptz;
alter table public.jobs add column if not exists cleaner_lat numeric(10,7);
alter table public.jobs add column if not exists cleaner_lng numeric(10,7);
alter table public.jobs add column if not exists cleaner_location_accuracy numeric(10,2);
alter table public.jobs add column if not exists cleaner_location_at timestamptz;

drop function if exists public.portal_cleaner_mark_arrived(uuid, text, uuid, timestamptz);

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
declare
  c public.cleaners;
begin
  select * into c from public.cleaners where id = cleaner_id;
  if not found or c.archived = true or not public.portal_cleaner_key_matches(c, cleaner_key) then
    raise exception 'invalid cleaner portal access';
  end if;

  update public.jobs
  set assigned_cleaner_id = c.id,
      status = 'in_site',
      actual_start = coalesce(p_actual_start, now()),
      cleaner_lat = p_lat,
      cleaner_lng = p_lng,
      cleaner_location_accuracy = p_accuracy,
      cleaner_location_at = coalesce(p_location_at, now()),
      updated_at = now()
  where id = job_id
    and organization_id = c.organization_id
    and (assigned_cleaner_id = c.id or assigned_cleaner_id is null);

  if not found then
    raise exception 'job not available for cleaner';
  end if;
end;
$$;

grant execute on function public.portal_cleaner_mark_arrived(uuid, text, uuid, timestamptz, numeric, numeric, numeric, timestamptz) to anon, authenticated;
