-- Fix existing users who were created before the auto-provision trigger was pushed

do $$
declare
  u record;
  new_org_id uuid;
begin
  for u in 
    select id, raw_user_meta_data 
    from auth.users 
    where id not in (select user_id from public.organization_members)
  loop
    new_org_id := gen_random_uuid();
    
    insert into public.organizations (id, name, type)
    values (new_org_id, coalesce(u.raw_user_meta_data->>'businessName', 'My Cleaning Business'), 'solo');
    
    insert into public.organization_members (organization_id, user_id, role)
    values (new_org_id, u.id, 'owner');
  end loop;
end;
$$;

-- Fix the broken trigger function to use the correct table name
create or replace function public.handle_new_user() 
returns trigger as $$
declare
  new_org_id uuid;
begin
  new_org_id := gen_random_uuid();
  
  insert into public.organizations (id, name, type)
  values (new_org_id, coalesce(new.raw_user_meta_data->>'businessName', 'My Cleaning Business'), 'solo');
  
  insert into public.organization_members (organization_id, user_id, role)
  values (new_org_id, new.id, 'owner');
  
  return new;
end;
$$ language plpgsql security definer;
