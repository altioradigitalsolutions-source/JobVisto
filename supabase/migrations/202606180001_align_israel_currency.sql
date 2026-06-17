update public.organizations
set currency = 'ILS',
    updated_at = now()
where country = 'IL'
  and currency = 'USD';
