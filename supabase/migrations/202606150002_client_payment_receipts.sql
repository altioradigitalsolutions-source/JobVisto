create table if not exists public.client_payment_receipts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  client_id uuid references public.clients(id) on delete set null,
  client_name text,
  amount_received numeric(10,2) not null default 0,
  discount numeric(10,2) not null default 0,
  subtotal numeric(10,2) not null default 0,
  balance_after numeric(10,2) not null default 0,
  payment_method text not null default 'Efectivo',
  job_ids uuid[] not null default '{}',
  paid_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.client_payment_receipts enable row level security;

drop policy if exists "client payment receipts member read" on public.client_payment_receipts;
create policy "client payment receipts member read" on public.client_payment_receipts
  for select using (public.is_org_member(organization_id));

drop policy if exists "client payment receipts admin manage" on public.client_payment_receipts;
create policy "client payment receipts admin manage" on public.client_payment_receipts
  for all using (public.is_org_admin(organization_id))
  with check (public.is_org_admin(organization_id));

notify pgrst, 'reload schema';
