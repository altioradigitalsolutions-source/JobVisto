alter table public.clients drop constraint if exists clients_preferred_language_check;
alter table public.clients
  add constraint clients_preferred_language_check
  check (preferred_language in ('en', 'es', 'ru', 'he'));

create unique index if not exists client_addresses_one_main_per_client_idx
  on public.client_addresses(client_id);
