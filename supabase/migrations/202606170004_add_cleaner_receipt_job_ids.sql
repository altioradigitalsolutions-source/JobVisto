alter table public.payment_receipts
  add column if not exists job_ids uuid[] not null default '{}';
