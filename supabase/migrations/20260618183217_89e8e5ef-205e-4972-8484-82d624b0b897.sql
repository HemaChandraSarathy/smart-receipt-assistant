CREATE POLICY "users read own golden files"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (bucket_id = 'golden' AND auth.uid()::text = (storage.foldername(name))[1]);

CREATE POLICY "users write own golden files"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (bucket_id = 'golden' AND auth.uid()::text = (storage.foldername(name))[1]);

CREATE POLICY "users update own golden files"
  ON storage.objects FOR UPDATE
  TO authenticated
  USING (bucket_id = 'golden' AND auth.uid()::text = (storage.foldername(name))[1]);

CREATE POLICY "users delete own golden files"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (bucket_id = 'golden' AND auth.uid()::text = (storage.foldername(name))[1]);