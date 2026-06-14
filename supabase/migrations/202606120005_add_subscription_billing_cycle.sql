alter table public.stripe_payments
  add column if not exists billing_cycle text not null default 'monthly'
  check (billing_cycle in ('monthly', 'annual'));

alter table public.subscriptions
  add column if not exists billing_cycle text not null default 'monthly'
  check (billing_cycle in ('monthly', 'annual'));
