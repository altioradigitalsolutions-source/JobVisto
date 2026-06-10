-- Migration: Add review fields to jobs table
alter table public.jobs add column if not exists request_review boolean not null default false;
alter table public.jobs add column if not exists client_rating integer;
alter table public.jobs add column if not exists client_review_text text;

-- Refresh the schema cache
notify pgrst, 'reload schema';
