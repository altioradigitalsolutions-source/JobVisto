-- Fix user provisioning so new Auth users create a valid profile and organization.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  pref_lang text;
  full_name text;
  phone_num text;
  comp_name text;
  org_type text;
  plan_id text;
  org_country text;
begin
  full_name := coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email, '@', 1));
  phone_num := coalesce(new.raw_user_meta_data->>'phone', '');
  pref_lang := coalesce(new.raw_user_meta_data->>'language', 'es');
  comp_name := coalesce(new.raw_user_meta_data->>'company_name', new.raw_user_meta_data->>'businessName', full_name || ' Company');
  org_type := coalesce(new.raw_user_meta_data->>'mode', 'independent');
  plan_id := coalesce(new.raw_user_meta_data->>'plan_id', 'solo');
  org_country := coalesce(new.raw_user_meta_data->>'country', 'IL');

  insert into public.profiles (id, full_name, email, phone, preferred_language)
  values (new.id, full_name, new.email, phone_num, pref_lang)
  on conflict (id) do update set
    full_name = excluded.full_name,
    email = excluded.email,
    phone = excluded.phone,
    preferred_language = excluded.preferred_language;

  insert into public.organizations (name, type, owner_user_id, country, default_language, plan_id)
  values (comp_name, org_type::public.organization_type, new.id, org_country, pref_lang, plan_id)
  on conflict do nothing;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
