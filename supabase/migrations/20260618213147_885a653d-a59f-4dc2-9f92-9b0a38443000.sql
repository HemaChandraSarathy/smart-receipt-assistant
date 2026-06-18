DROP FUNCTION IF EXISTS public.match_items(vector, integer);

CREATE OR REPLACE FUNCTION public.match_items(query_embedding vector, match_count integer DEFAULT 8)
 RETURNS TABLE(id uuid, title text, category item_category, topic text, assignee assignee, merchant text, amount numeric, due_at timestamp with time zone, expires_at timestamp with time zone, status text, completed_at timestamp with time zone, similarity double precision)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  select i.id, i.title, i.category, i.topic, i.assignee, i.merchant, i.amount,
         i.due_at, i.expires_at,
         coalesce(i.status, 'open')::text as status,
         i.completed_at,
         1 - (i.embedding <=> query_embedding) as similarity
  from public.items i
  where i.deleted_at is null and i.embedding is not null
  order by i.embedding <=> query_embedding
  limit match_count;
$function$;