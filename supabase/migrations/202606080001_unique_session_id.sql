-- Migration: Add unique constraint on session_id for stripe_payments
alter table public.stripe_payments add constraint stripe_payments_session_id_key unique (session_id);
