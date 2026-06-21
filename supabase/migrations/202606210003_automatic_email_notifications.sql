alter table public.notifications add column if not exists job_id uuid references public.jobs(id) on delete cascade;
alter table public.notifications add column if not exists dedupe_key text;
alter table public.notifications add column if not exists recipient_email text;
alter table public.notifications add column if not exists subject text;
alter table public.notifications add column if not exists error_message text;
alter table public.notifications add column if not exists provider_message_id text;

create unique index if not exists notifications_dedupe_key_idx
  on public.notifications(dedupe_key)
  where dedupe_key is not null;

create index if not exists notifications_job_id_idx on public.notifications(job_id);
create index if not exists notifications_created_at_idx on public.notifications(created_at desc);
