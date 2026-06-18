CREATE TABLE public.golden_examples (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title text NOT NULL,
  image_path text,
  source_text text,
  notes text,
  expected_items jsonb NOT NULL DEFAULT '[]'::jsonb,
  expected_clarifications jsonb NOT NULL DEFAULT '[]'::jsonb,
  failure_tags text[] NOT NULL DEFAULT '{}',
  last_eval jsonb,
  last_eval_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.golden_examples TO authenticated;
GRANT ALL ON public.golden_examples TO service_role;

ALTER TABLE public.golden_examples ENABLE ROW LEVEL SECURITY;

CREATE POLICY "owner can manage own golden examples"
  ON public.golden_examples FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE TRIGGER golden_examples_set_updated_at
  BEFORE UPDATE ON public.golden_examples
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

CREATE INDEX golden_examples_user_recent ON public.golden_examples (user_id, created_at DESC);