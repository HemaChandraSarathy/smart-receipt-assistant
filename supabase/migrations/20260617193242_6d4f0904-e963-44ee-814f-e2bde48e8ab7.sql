
-- match_items: doesn't need elevated privileges; RLS on items already scopes by user
create or replace function public.match_items(
  query_embedding vector(1536),
  match_count int default 8
) returns table (
  id uuid, title text, category public.item_category, topic text,
  assignee public.assignee, merchant text, amount numeric,
  due_at timestamptz, expires_at timestamptz, similarity float
) language sql stable security invoker set search_path = public as $$
  select i.id, i.title, i.category, i.topic, i.assignee, i.merchant, i.amount,
         i.due_at, i.expires_at,
         1 - (i.embedding <=> query_embedding) as similarity
  from public.items i
  where i.archived = false and i.embedding is not null
  order by i.embedding <=> query_embedding
  limit match_count;
$$;

-- Lock down the signup-trigger function: only the trigger context should call it
revoke execute on function public.seed_assignment_rules() from public, anon, authenticated;
