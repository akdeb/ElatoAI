-- Creators can edit and delete their own characters (built-in characters have no creator).
CREATE POLICY "personalities_update_own" ON personalities
FOR UPDATE TO authenticated
USING (creator_id = auth.uid())
WITH CHECK (creator_id = auth.uid());

CREATE POLICY "personalities_delete_own" ON personalities
FOR DELETE TO authenticated
USING (creator_id = auth.uid());
