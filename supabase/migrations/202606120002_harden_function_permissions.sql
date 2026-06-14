-- Reduce direct execution of internal helper functions while keeping
-- key-protected portal RPCs available to public portal links.

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

alter function public.create_owner_membership() set search_path = public, pg_temp;
alter function public.handle_new_user() set search_path = public, pg_temp;
alter function public.is_org_member(uuid) set search_path = public, pg_temp;
alter function public.is_org_admin(uuid) set search_path = public, pg_temp;
alter function public.portal_client_key_matches(public.clients, text) set search_path = public, pg_temp;
alter function public.portal_cleaner_key_matches(public.cleaners, text) set search_path = public, pg_temp;

revoke execute on function public.set_updated_at() from public, anon, authenticated;
revoke execute on function public.create_owner_membership() from public, anon, authenticated;
revoke execute on function public.handle_new_user() from public, anon, authenticated;
revoke execute on function public.portal_client_key_matches(public.clients, text) from public, anon, authenticated;
revoke execute on function public.portal_cleaner_key_matches(public.cleaners, text) from public, anon, authenticated;

revoke execute on function public.is_org_member(uuid) from public, anon;
revoke execute on function public.is_org_admin(uuid) from public, anon;
grant execute on function public.is_org_member(uuid) to authenticated;
grant execute on function public.is_org_admin(uuid) to authenticated;

notify pgrst, 'reload schema';
