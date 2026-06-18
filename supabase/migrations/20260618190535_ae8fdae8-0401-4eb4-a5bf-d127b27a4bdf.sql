create table public.gmail_scan_state (
  user_id uuid primary key references auth.users(id) on delete cascade,
  last_scanned_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

grant select, insert, update, delete on public.gmail_scan_state to authenticated;
grant all on public.gmail_scan_state to service_role;

alter table public.gmail_scan_state enable row level security;

create policy "users manage their own gmail scan state"
  on public.gmail_scan_state
  for all
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());