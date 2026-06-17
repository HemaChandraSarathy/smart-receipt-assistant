
-- Extensions
create extension if not exists vector;
create extension if not exists pgcrypto;

-- Enum types
do $$ begin
  create type public.item_category as enum ('bill','promo','coupon','invite','receipt','other');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.assignee as enum ('mom','dad','either');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.run_status as enum ('running','awaiting_approval','done','failed','cancelled');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.approval_status as enum ('pending','approved','edited','rejected');
exception when duplicate_object then null; end $$;

-- updated_at helper
create or replace function public.tg_set_updated_at()
returns trigger language plpgsql set search_path = public as $$
begin new.updated_at = now(); return new; end $$;

-- ===== agent_runs =====
create table public.agent_runs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  thread_id text not null,
  status public.run_status not null default 'running',
  input_kind text not null,
  input_ref jsonb not null default '{}'::jsonb,
  current_node text,
  langsmith_url text,
  error text,
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index agent_runs_user_started_idx on public.agent_runs(user_id, started_at desc);
create index agent_runs_status_idx on public.agent_runs(user_id, status);
grant select, insert, update, delete on public.agent_runs to authenticated;
grant all on public.agent_runs to service_role;
alter table public.agent_runs enable row level security;
create policy "own runs" on public.agent_runs for all to authenticated
  using (auth.uid() = user_id) with check (auth.uid() = user_id);
create trigger trg_agent_runs_updated before update on public.agent_runs
  for each row execute function public.tg_set_updated_at();

-- ===== agent_events =====
create table public.agent_events (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.agent_runs(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  node text not null,
  kind text not null,
  payload jsonb not null default '{}'::jsonb,
  ts timestamptz not null default now()
);
create index agent_events_run_ts_idx on public.agent_events(run_id, ts);
grant select, insert on public.agent_events to authenticated;
grant all on public.agent_events to service_role;
alter table public.agent_events enable row level security;
create policy "own events read" on public.agent_events for select to authenticated
  using (auth.uid() = user_id);
create policy "own events insert" on public.agent_events for insert to authenticated
  with check (auth.uid() = user_id);

-- ===== approvals =====
create table public.approvals (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.agent_runs(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  node text not null,
  action_kind text not null,
  proposal jsonb not null,
  status public.approval_status not null default 'pending',
  decision jsonb,
  decided_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index approvals_user_status_idx on public.approvals(user_id, status, created_at desc);
create index approvals_run_idx on public.approvals(run_id);
grant select, insert, update, delete on public.approvals to authenticated;
grant all on public.approvals to service_role;
alter table public.approvals enable row level security;
create policy "own approvals" on public.approvals for all to authenticated
  using (auth.uid() = user_id) with check (auth.uid() = user_id);
create trigger trg_approvals_updated before update on public.approvals
  for each row execute function public.tg_set_updated_at();

-- ===== items =====
create table public.items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  run_id uuid references public.agent_runs(id) on delete set null,
  category public.item_category not null default 'other',
  topic text,
  assignee public.assignee not null default 'either',
  merchant text,
  title text not null,
  description text,
  amount numeric(12,2),
  currency text default 'USD',
  due_at timestamptz,
  expires_at timestamptz,
  rsvp_by timestamptz,
  source text not null,
  source_ref jsonb default '{}'::jsonb,
  image_url text,
  raw jsonb default '{}'::jsonb,
  embedding vector(1536),
  archived boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index items_user_idx on public.items(user_id, created_at desc);
create index items_user_due_idx on public.items(user_id, due_at) where due_at is not null;
create index items_user_expires_idx on public.items(user_id, expires_at) where expires_at is not null;
create index items_embedding_idx on public.items using hnsw (embedding vector_cosine_ops);
grant select, insert, update, delete on public.items to authenticated;
grant all on public.items to service_role;
alter table public.items enable row level security;
create policy "own items" on public.items for all to authenticated
  using (auth.uid() = user_id) with check (auth.uid() = user_id);
create trigger trg_items_updated before update on public.items
  for each row execute function public.tg_set_updated_at();

-- ===== assignment_rules =====
create table public.assignment_rules (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  owner public.assignee not null,
  keywords text[] not null default '{}'::text[],
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index assignment_rules_user_idx on public.assignment_rules(user_id);
grant select, insert, update, delete on public.assignment_rules to authenticated;
grant all on public.assignment_rules to service_role;
alter table public.assignment_rules enable row level security;
create policy "own rules" on public.assignment_rules for all to authenticated
  using (auth.uid() = user_id) with check (auth.uid() = user_id);
create trigger trg_assignment_rules_updated before update on public.assignment_rules
  for each row execute function public.tg_set_updated_at();

-- ===== followups =====
create table public.followups (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  item_id uuid not null references public.items(id) on delete cascade,
  next_nudge_at timestamptz not null,
  channel text not null default 'in_app',
  state text not null default 'scheduled',
  attempts int not null default 0,
  last_run_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index followups_due_idx on public.followups(next_nudge_at) where state = 'scheduled';
create index followups_user_idx on public.followups(user_id, next_nudge_at);
grant select, insert, update, delete on public.followups to authenticated;
grant all on public.followups to service_role;
alter table public.followups enable row level security;
create policy "own followups" on public.followups for all to authenticated
  using (auth.uid() = user_id) with check (auth.uid() = user_id);
create trigger trg_followups_updated before update on public.followups
  for each row execute function public.tg_set_updated_at();

-- ===== agent_checkpoints (LangGraph state) =====
-- LangGraph's PostgresSaver manages its own tables; we keep a thin mirror for app-side cleanup/queries.
create table public.agent_checkpoints (
  thread_id text not null,
  checkpoint_id text not null,
  parent_id text,
  user_id uuid not null references auth.users(id) on delete cascade,
  payload jsonb not null,
  created_at timestamptz not null default now(),
  primary key (thread_id, checkpoint_id)
);
create index agent_checkpoints_user_idx on public.agent_checkpoints(user_id, created_at desc);
grant select, insert, update, delete on public.agent_checkpoints to authenticated;
grant all on public.agent_checkpoints to service_role;
alter table public.agent_checkpoints enable row level security;
create policy "own checkpoints" on public.agent_checkpoints for all to authenticated
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ===== semantic search RPC =====
create or replace function public.match_items(
  query_embedding vector(1536),
  match_count int default 8
) returns table (
  id uuid,
  title text,
  category public.item_category,
  topic text,
  assignee public.assignee,
  merchant text,
  amount numeric,
  due_at timestamptz,
  expires_at timestamptz,
  similarity float
) language sql stable security definer set search_path = public as $$
  select i.id, i.title, i.category, i.topic, i.assignee, i.merchant, i.amount,
         i.due_at, i.expires_at,
         1 - (i.embedding <=> query_embedding) as similarity
  from public.items i
  where i.user_id = auth.uid()
    and i.archived = false
    and i.embedding is not null
  order by i.embedding <=> query_embedding
  limit match_count;
$$;
grant execute on function public.match_items(vector, int) to authenticated;

-- ===== seed assignment_rules trigger (on new user signup) =====
create or replace function public.seed_assignment_rules()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.assignment_rules(user_id, owner, keywords) values
    (new.id, 'mom', array['kids','child','medical','doctor','dentist','pediatric','summer camp','grocery','food','restaurant','school','event','party','rsvp','birthday','playdate']),
    (new.id, 'dad', array['car','auto','vehicle','hvac','furnace','ac','plumbing','plumber','lawn','tree','trimming','utility','utilities','electric','gas','water','home repair','maintenance','insurance','mortgage','handyman']);
  return new;
end $$;

drop trigger if exists trg_seed_assignment_rules on auth.users;
create trigger trg_seed_assignment_rules
  after insert on auth.users
  for each row execute function public.seed_assignment_rules();
