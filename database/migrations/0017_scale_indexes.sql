-- Indexes needed once wards hold real volumes (thousands of features per source, ~100 wards).

-- conflicts.match_id: every displaced match deletes its conflicts (ON DELETE CASCADE), and
-- detect_conflicts / assemble look conflicts up by match. Without it each is a sequential scan.
CREATE INDEX IF NOT EXISTS conflicts_match_idx ON conflicts (match_id);

-- matches.feature_b_id: deleting a source cascades to matches through both feature columns;
-- feature_a_id is already covered by the UNIQUE (feature_a_id, feature_b_id) index.
CREATE INDEX IF NOT EXISTS matches_feature_b_idx ON matches (feature_b_id);

-- Finalisation readiness asks, per golden record, whether any open topology issue touches one of
-- its member features (feature_ids && member_feature_ids).
CREATE INDEX IF NOT EXISTS topology_issues_open_features_idx
  ON topology_issues USING GIN (feature_ids) WHERE status = 'open';
