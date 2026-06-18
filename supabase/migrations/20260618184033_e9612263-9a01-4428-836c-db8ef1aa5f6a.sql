
ALTER TABLE public.items ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
ALTER TABLE public.approvals ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
ALTER TABLE public.agent_runs ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
ALTER TABLE public.notifications ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
ALTER TABLE public.golden_examples ADD COLUMN IF NOT EXISTS deleted_at timestamptz;

CREATE INDEX IF NOT EXISTS items_user_active_idx ON public.items(user_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS approvals_user_active_idx ON public.approvals(user_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS agent_runs_user_active_idx ON public.agent_runs(user_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS notifications_user_active_idx ON public.notifications(user_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS golden_examples_user_active_idx ON public.golden_examples(user_id) WHERE deleted_at IS NULL;
