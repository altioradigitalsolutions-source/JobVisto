-- JobVisto Supabase schema
-- Production-ready first schema for organizations, cleaners, clients, jobs,
-- evidence, signatures, private links, external payment receipts and plans.

create extension if not exists "pgcrypto";

do $$
begin
  create type public.organization_type as enum ('independent', 'company');
exception when duplicate_object then null;
end $$;

do $$
begin
  create type public.member_role as enum ('owner', 'manager', 'cleaner');
exception when duplicate_object then null;
end $$;

do $$
begin
  create type public.member_status as enum ('invited', 'active', 'disabled');
exception when duplicate_object then null;
end $$;

do $$
begin
  create type public.worker_type as enum ('employee', 'freelancer', 'independent');
exception when duplicate_object then null;
end $$;

do $$
begin
  create type public.job_status as enum ('draft', 'scheduled', 'open', 'assigned', 'in_site', 'cleaner_finished', 'client_confirmed', 'signed', 'suspended', 'cancelled');
exception when duplicate_object then null;
end $$;

do $$
begin
  create type public.check_event_type as enum ('check_in', 'check_out');
exception when duplicate_object then null;
end $$;

do $$
begin
  create type public.evidence_phase as enum ('before', 'after', 'general', 'incident');
exception when duplicate_object then null;
end $$;

do $$
begin
  create type public.payment_method as enum ('cash', 'transfer', 'paypal', 'zelle', 'card', 'check', 'other');
exception when duplicate_object then null;
end $$;

do $$
begin
  create type public.receipt_status as enum ('draft', 'signed', 'void');
exception when duplicate_object then null;
end $$;

do $$
begin
  create type public.rule_mode as enum ('replace', 'add');
exception when duplicate_object then null;
end $$;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text,
  email text not null,
  phone text,
  avatar_url text,
  preferred_language text not null default 'en' check (preferred_language in ('en', 'es', 'ru')),
  email_verified boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.plans (
  id text primary key,
  name text not null,
  plan_type organization_type not null,
  monthly_price numeric(10,2) not null,
  launch_price numeric(10,2),
  included_cleaners integer not null default 1,
  features jsonb not null default '[]'::jsonb,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  type organization_type not null,
  owner_user_id uuid not null references public.profiles(id) on delete restrict,
  country text not null,
  dial_code text,
  currency text not null default 'USD',
  timezone text not null default 'UTC',
  default_language text not null default 'en' check (default_language in ('en', 'es', 'ru')),
  plan_id text references public.plans(id),
  status text not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.organization_members (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  role member_role not null,
  status member_status not null default 'active',
  invited_at timestamptz,
  joined_at timestamptz,
  created_at timestamptz not null default now(),
  unique (organization_id, user_id)
);

create table if not exists public.cleaners (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid references public.profiles(id) on delete set null,
  name text not null,
  email text,
  phone text,
  access_key text not null,
  worker_type worker_type not null default 'freelancer',
  base_hourly_rate numeric(10,2) default 0,
  currency text not null default 'USD',
  language text not null default 'en' check (language in ('en', 'es', 'ru')),
  country text,
  region text,
  city text,
  status text not null default 'available',
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, access_key)
);

create table if not exists public.clients (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  phone text,
  email text,
  preferred_language text not null default 'en' check (preferred_language in ('en', 'es', 'ru')),
  notification_channel text not null default 'email',
  default_payment_method payment_method default 'cash',
  notes text,
  internal_notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.client_addresses (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  label text not null default 'Main',
  address_line text not null,
  country text,
  region text,
  city text,
  latitude numeric(10,7),
  longitude numeric(10,7),
  access_notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.service_price_rules (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  service_type text not null,
  client_hourly_rate numeric(10,2) not null default 0,
  currency text not null default 'USD',
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, service_type)
);

create table if not exists public.cleaner_cost_rules (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  cleaner_id uuid references public.cleaners(id) on delete cascade,
  name text not null,
  hourly_rate numeric(10,2) not null default 0,
  mode rule_mode not null default 'replace',
  is_general boolean not null default false,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.jobs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete restrict,
  address_id uuid references public.client_addresses(id) on delete set null,
  assigned_cleaner_id uuid references public.cleaners(id) on delete set null,
  title text,
  service_type text not null,
  scheduled_start timestamptz not null,
  scheduled_end timestamptz,
  actual_start timestamptz,
  actual_end timestamptz,
  pricing_type text not null default 'hourly' check (pricing_type in ('hourly', 'fixed')),
  client_hourly_rate numeric(10,2) default 0,
  fixed_price numeric(10,2),
  extras_amount numeric(10,2) not null default 0,
  cleaner_hourly_rate_snapshot numeric(10,2) default 0,
  currency text not null default 'USD',
  status job_status not null default 'scheduled',
  recurrence_rule text,
  requires_photos boolean not null default true,
  requires_client_signature boolean not null default true,
  notify_client boolean not null default true,
  checklist text[] not null default '{}'::text[],
  cleaner_notes text,
  internal_notes text,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.job_tasks (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  job_id uuid not null references public.jobs(id) on delete cascade,
  title text not null,
  area text,
  status text not null default 'pending' check (status in ('pending', 'done', 'skipped')),
  completed_at timestamptz,
  notes text,
  created_at timestamptz not null default now()
);

create table if not exists public.job_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  job_id uuid not null references public.jobs(id) on delete cascade,
  cleaner_id uuid references public.cleaners(id) on delete set null,
  type check_event_type not null,
  happened_at timestamptz not null default now(),
  latitude numeric(10,7),
  longitude numeric(10,7),
  accuracy numeric(10,2),
  device_time timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.job_evidence (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  job_id uuid not null references public.jobs(id) on delete cascade,
  uploaded_by_cleaner_id uuid references public.cleaners(id) on delete set null,
  area text not null,
  phase evidence_phase not null,
  file_path text not null,
  thumbnail_path text,
  caption text,
  created_at timestamptz not null default now()
);

create table if not exists public.job_incidents (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  job_id uuid not null references public.jobs(id) on delete cascade,
  cleaner_id uuid references public.cleaners(id) on delete set null,
  type text not null,
  description text not null,
  evidence_id uuid references public.job_evidence(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.client_signatures (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  job_id uuid not null references public.jobs(id) on delete cascade,
  signer_name text not null,
  signature_data text not null,
  confirmation_text text,
  signed_at timestamptz not null default now(),
  signed_from text not null default 'private_link' check (signed_from in ('cleaner_device', 'private_link'))
);

create table if not exists public.private_links (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  client_id uuid references public.clients(id) on delete cascade,
  job_id uuid references public.jobs(id) on delete cascade,
  token text not null unique default encode(extensions.gen_random_bytes(24), 'hex'),
  passcode_hash text,
  link_type text not null default 'client_portal' check (link_type in ('client_portal', 'job_signature', 'cleaner_portal')),
  expires_at timestamptz,
  viewed_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.payment_receipts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  cleaner_id uuid not null references public.cleaners(id) on delete restrict,
  period_start date,
  period_end date,
  amount numeric(10,2) not null,
  currency text not null default 'USD',
  payment_method payment_method not null,
  paid_at timestamptz not null default now(),
  registered_by_user_id uuid references public.profiles(id) on delete set null,
  receiver_name text,
  receiver_signature_data text,
  notes text,
  status receipt_status not null default 'draft',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  recipient_type text not null check (recipient_type in ('user', 'cleaner', 'client')),
  recipient_id uuid,
  channel text not null check (channel in ('email', 'whatsapp', 'sms', 'push')),
  template_key text not null,
  status text not null default 'pending',
  payload jsonb not null default '{}'::jsonb,
  sent_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  plan_id text not null references public.plans(id),
  status text not null default 'pending',
  started_at timestamptz,
  trial_ends_at timestamptz,
  current_period_start timestamptz,
  current_period_end timestamptz,
  provider text default 'stripe',
  provider_customer_id text,
  provider_subscription_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.organization_settings (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  key text not null,
  value jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, key)
);

create index if not exists idx_org_members_user on public.organization_members(user_id);
create index if not exists idx_cleaners_org on public.cleaners(organization_id);
create index if not exists idx_clients_org on public.clients(organization_id);
create index if not exists idx_jobs_org_date on public.jobs(organization_id, scheduled_start);
create index if not exists idx_jobs_cleaner_date on public.jobs(assigned_cleaner_id, scheduled_start);
create index if not exists idx_evidence_job on public.job_evidence(job_id);
create index if not exists idx_private_links_token on public.private_links(token);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create or replace function public.is_org_member(org_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.organization_members m
    where m.organization_id = org_id
      and m.user_id = auth.uid()
      and m.status = 'active'
  );
$$;

create or replace function public.is_org_admin(org_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.organization_members m
    where m.organization_id = org_id
      and m.user_id = auth.uid()
      and m.role in ('owner', 'manager')
      and m.status = 'active'
  );
$$;

create or replace function public.create_owner_membership()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.organization_members (organization_id, user_id, role, status, joined_at)
  values (new.id, new.owner_user_id, 'owner', 'active', now())
  on conflict (organization_id, user_id) do nothing;
  return new;
end;
$$;

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'profiles','organizations','cleaners','clients','client_addresses',
    'service_price_rules','cleaner_cost_rules','jobs','payment_receipts',
    'subscriptions','organization_settings'
  ]
  loop
    execute format('drop trigger if exists set_%I_updated_at on public.%I', table_name, table_name);
    execute format('create trigger set_%I_updated_at before update on public.%I for each row execute function public.set_updated_at()', table_name, table_name);
  end loop;
end $$;

drop trigger if exists create_owner_membership_after_organization on public.organizations;
create trigger create_owner_membership_after_organization
after insert on public.organizations
for each row execute function public.create_owner_membership();

alter table public.profiles enable row level security;
alter table public.plans enable row level security;
alter table public.organizations enable row level security;
alter table public.organization_members enable row level security;
alter table public.cleaners enable row level security;
alter table public.clients enable row level security;
alter table public.client_addresses enable row level security;
alter table public.service_price_rules enable row level security;
alter table public.cleaner_cost_rules enable row level security;
alter table public.jobs enable row level security;
alter table public.job_tasks enable row level security;
alter table public.job_events enable row level security;
alter table public.job_evidence enable row level security;
alter table public.job_incidents enable row level security;
alter table public.client_signatures enable row level security;
alter table public.private_links enable row level security;
alter table public.payment_receipts enable row level security;
alter table public.notifications enable row level security;
alter table public.subscriptions enable row level security;
alter table public.organization_settings enable row level security;

create policy "profiles own read" on public.profiles for select using (id = auth.uid());
create policy "profiles own update" on public.profiles for update using (id = auth.uid());
create policy "profiles own insert" on public.profiles for insert with check (id = auth.uid());

create policy "plans public read" on public.plans for select using (is_active = true);

create policy "organizations member read" on public.organizations for select using (public.is_org_member(id));
create policy "organizations owner create" on public.organizations for insert with check (owner_user_id = auth.uid());
create policy "organizations admin update" on public.organizations for update using (public.is_org_admin(id));

create policy "members member read" on public.organization_members for select using (public.is_org_member(organization_id));
create policy "members admin manage" on public.organization_members for all using (public.is_org_admin(organization_id)) with check (public.is_org_admin(organization_id));

create policy "cleaners member read" on public.cleaners for select using (public.is_org_member(organization_id));
create policy "cleaners admin manage" on public.cleaners for all using (public.is_org_admin(organization_id)) with check (public.is_org_admin(organization_id));

create policy "clients member read" on public.clients for select using (public.is_org_member(organization_id));
create policy "clients admin manage" on public.clients for all using (public.is_org_admin(organization_id)) with check (public.is_org_admin(organization_id));

create policy "addresses member read" on public.client_addresses for select using (public.is_org_member(organization_id));
create policy "addresses admin manage" on public.client_addresses for all using (public.is_org_admin(organization_id)) with check (public.is_org_admin(organization_id));

create policy "service rules member read" on public.service_price_rules for select using (public.is_org_member(organization_id));
create policy "service rules admin manage" on public.service_price_rules for all using (public.is_org_admin(organization_id)) with check (public.is_org_admin(organization_id));

create policy "cost rules member read" on public.cleaner_cost_rules for select using (public.is_org_member(organization_id));
create policy "cost rules admin manage" on public.cleaner_cost_rules for all using (public.is_org_admin(organization_id)) with check (public.is_org_admin(organization_id));

create policy "jobs member read" on public.jobs for select using (public.is_org_member(organization_id));
create policy "jobs admin manage" on public.jobs for all using (public.is_org_admin(organization_id)) with check (public.is_org_admin(organization_id));

create policy "job tasks member read" on public.job_tasks for select using (public.is_org_member(organization_id));
create policy "job tasks admin manage" on public.job_tasks for all using (public.is_org_admin(organization_id)) with check (public.is_org_admin(organization_id));

create policy "job events member read" on public.job_events for select using (public.is_org_member(organization_id));
create policy "job events member create" on public.job_events for insert with check (public.is_org_member(organization_id));

create policy "job evidence member read" on public.job_evidence for select using (public.is_org_member(organization_id));
create policy "job evidence member create" on public.job_evidence for insert with check (public.is_org_member(organization_id));
create policy "job evidence admin delete" on public.job_evidence for delete using (public.is_org_admin(organization_id));

create policy "incidents member read" on public.job_incidents for select using (public.is_org_member(organization_id));
create policy "incidents member create" on public.job_incidents for insert with check (public.is_org_member(organization_id));

create policy "client signatures member read" on public.client_signatures for select using (public.is_org_member(organization_id));
create policy "client signatures member create" on public.client_signatures for insert with check (public.is_org_member(organization_id));

create policy "private links admin read" on public.private_links for select using (public.is_org_admin(organization_id));
create policy "private links admin manage" on public.private_links for all using (public.is_org_admin(organization_id)) with check (public.is_org_admin(organization_id));

create policy "receipts member read" on public.payment_receipts for select using (public.is_org_member(organization_id));
create policy "receipts admin manage" on public.payment_receipts for all using (public.is_org_admin(organization_id)) with check (public.is_org_admin(organization_id));

create policy "notifications member read" on public.notifications for select using (public.is_org_member(organization_id));
create policy "notifications admin manage" on public.notifications for all using (public.is_org_admin(organization_id)) with check (public.is_org_admin(organization_id));

create policy "subscriptions admin read" on public.subscriptions for select using (public.is_org_admin(organization_id));
create policy "subscriptions admin manage" on public.subscriptions for all using (public.is_org_admin(organization_id)) with check (public.is_org_admin(organization_id));

create policy "settings member read" on public.organization_settings for select using (public.is_org_member(organization_id));
create policy "settings admin manage" on public.organization_settings for all using (public.is_org_admin(organization_id)) with check (public.is_org_admin(organization_id));

insert into public.plans (id, name, plan_type, monthly_price, launch_price, included_cleaners, features)
values
  ('solo', 'Independent', 'independent', 9.99, 4.99, 1, '["clients","jobs","calendar","photos","client_signature","basic_reports"]'::jsonb),
  ('starter', 'Company Starter', 'company', 39.00, 29.00, 3, '["cleaners","jobs","calendar","photos","client_links","basic_reports"]'::jsonb),
  ('pro', 'Company Pro', 'company', 79.00, 59.00, 8, '["cleaners","gps","client_notifications","payment_receipts","advanced_reports","extra_cleaners"]'::jsonb)
on conflict (id) do update set
  name = excluded.name,
  plan_type = excluded.plan_type,
  monthly_price = excluded.monthly_price,
  launch_price = excluded.launch_price,
  included_cleaners = excluded.included_cleaners,
  features = excluded.features,
  is_active = true;

insert into storage.buckets (id, name, public)
values
  ('job-evidence', 'job-evidence', false),
  ('job-signatures', 'job-signatures', false)
on conflict (id) do nothing;

create policy "job evidence storage own read" on storage.objects
for select to authenticated
using (bucket_id = 'job-evidence' and owner = auth.uid());

create policy "job evidence storage own upload" on storage.objects
for insert to authenticated
with check (bucket_id = 'job-evidence' and owner = auth.uid());

create policy "job evidence storage own update" on storage.objects
for update to authenticated
using (bucket_id = 'job-evidence' and owner = auth.uid())
with check (bucket_id = 'job-evidence' and owner = auth.uid());

create policy "job signatures storage own read" on storage.objects
for select to authenticated
using (bucket_id = 'job-signatures' and owner = auth.uid());

create policy "job signatures storage own upload" on storage.objects
for insert to authenticated
with check (bucket_id = 'job-signatures' and owner = auth.uid());

create policy "job signatures storage own update" on storage.objects
for update to authenticated
using (bucket_id = 'job-signatures' and owner = auth.uid())
with check (bucket_id = 'job-signatures' and owner = auth.uid());
