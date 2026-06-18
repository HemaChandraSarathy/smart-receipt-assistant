-- Lifecycle columns on items
ALTER TABLE public.items
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'open',
  ADD COLUMN IF NOT EXISTS completed_at timestamptz,
  ADD COLUMN IF NOT EXISTS cancelled_at timestamptz,
  ADD COLUMN IF NOT EXISTS calendar_event_id text,
  ADD COLUMN IF NOT EXISTS reschedule_count int NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS original_due_at timestamptz;

ALTER TABLE public.items
  DROP CONSTRAINT IF EXISTS items_status_check;
ALTER TABLE public.items
  ADD CONSTRAINT items_status_check CHECK (status IN ('open','done','cancelled'));

CREATE INDEX IF NOT EXISTS items_user_status_idx ON public.items(user_id, status, completed_at DESC);

-- Notifications table
CREATE TABLE IF NOT EXISTS public.notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  item_id uuid REFERENCES public.items(id) ON DELETE CASCADE,
  kind text NOT NULL DEFAULT 'nudge',
  title text NOT NULL,
  body text,
  read_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.notifications TO authenticated;
GRANT ALL ON public.notifications TO service_role;

ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "own notifications" ON public.notifications;
CREATE POLICY "own notifications" ON public.notifications
  FOR ALL TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS notifications_user_idx
  ON public.notifications(user_id, read_at, created_at DESC);