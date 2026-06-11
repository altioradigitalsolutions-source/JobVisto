-- Persist client payment state per job so collections survive refresh/login.

alter table public.jobs add column if not exists client_paid_amount numeric(10,2) not null default 0;
alter table public.jobs add column if not exists client_payment_status text not null default 'unpaid'
  check (client_payment_status in ('unpaid', 'partial', 'paid'));
alter table public.jobs add column if not exists client_paid_date date;
alter table public.jobs add column if not exists client_payment_method text;

notify pgrst, 'reload schema';
