-- Migration: Create stripe_payments table for storing webhook events
create table if not exists public.stripe_payments (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  plan_id text not null,
  customer_id text,
  subscription_id text,
  session_id text,
  payment_status text,
  created_at timestamptz not null default now()
);

-- Enable Row Level Security
alter table public.stripe_payments enable row level security;

-- Drop policy if exists
drop policy if exists "stripe_payments own read" on public.stripe_payments;

-- Create policy allowing authenticated users to select only their own stripe payments matching their email
create policy "stripe_payments own read" on public.stripe_payments
  for select
  using (auth.jwt() ->> 'email' = email);

-- Create policy allowing all actions for service_role (implicit in Supabase, but let's be explicit)
drop policy if exists "stripe_payments service role manage" on public.stripe_payments;
create policy "stripe_payments service role manage" on public.stripe_payments
  for all
  to service_role
  using (true)
  with check (true);
