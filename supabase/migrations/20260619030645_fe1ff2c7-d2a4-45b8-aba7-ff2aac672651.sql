DROP POLICY IF EXISTS "owner can manage own golden examples" ON public.golden_examples;
CREATE POLICY "owner can manage own golden examples"
  ON public.golden_examples
  FOR ALL
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);