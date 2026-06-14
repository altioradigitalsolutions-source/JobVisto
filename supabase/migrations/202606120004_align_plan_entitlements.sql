-- Align production plan catalog with the public JobVisto pricing page.

insert into public.plans (id, name, plan_type, monthly_price, launch_price, included_cleaners, features, is_active)
values
  (
    'free',
    'Freelancer Free',
    'independent',
    0,
    0,
    1,
    '["max_clients:3","max_monthly_jobs:5","calendar_basic","photos","client_signature","client_portal"]'::jsonb,
    true
  ),
  (
    'solo',
    'Independent',
    'independent',
    9.99,
    9.99,
    1,
    '["max_clients:20","unlimited_jobs","calendar_full","photos","notes","client_signature","arrival_departure","client_portal"]'::jsonb,
    true
  ),
  (
    'starter',
    'Company',
    'company',
    29.99,
    29.99,
    5,
    '["unlimited_clients","unlimited_jobs","calendar_by_cleaner","photos","notes","checklists","client_signature","client_portal","cleaner_portal","operational_reports","email_support"]'::jsonb,
    true
  ),
  (
    'pro',
    'Pro',
    'company',
    59.99,
    59.99,
    20,
    '["everything_company","cleaner_payment_receipts","individual_payouts","consolidated_payouts","advanced_reports","advanced_history","pending_signature_control","simple_export","client_notifications","priority_support"]'::jsonb,
    true
  )
on conflict (id) do update set
  name = excluded.name,
  plan_type = excluded.plan_type,
  monthly_price = excluded.monthly_price,
  launch_price = excluded.launch_price,
  included_cleaners = excluded.included_cleaners,
  features = excluded.features,
  is_active = excluded.is_active;

notify pgrst, 'reload schema';
