-- Officer decisions on candidate matches: the training labels for the ML spatial matcher
-- (worker harmonize/ml_match.py, retrained by the RETRAIN_MATCHER job).
--
-- A separate table, not columns on matches: match.py rewrites a ward's matches on every run, and a
-- label must outlive that. `features` is the feature snapshot the worker stored in
-- matches.confidence_breakdown.ml_features when the officer saw the match, so training never
-- recomputes features from data that may have changed since. No FK to source_features for the
-- same reason — a re-uploaded source must not delete the labels learned from it.
-- In match.py a confirmed pair is always kept and a rejected pair is never proposed again.
CREATE TABLE IF NOT EXISTS match_labels (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ward_id       text REFERENCES wards(id),
  feature_a_id  uuid NOT NULL,
  feature_b_id  uuid NOT NULL,
  source_a_type source_type,
  source_b_type source_type,
  label         boolean NOT NULL,                    -- true = same land record
  features      jsonb NOT NULL DEFAULT '{}'::jsonb,
  match_score   numeric(5,2),                        -- what the matcher said when labelled
  model_version text,                                -- null = rule-based matcher
  labelled_by   text,
  labelled_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (feature_a_id, feature_b_id)
);
CREATE INDEX IF NOT EXISTS match_labels_ward_idx ON match_labels (ward_id);
CREATE INDEX IF NOT EXISTS match_labels_time_idx ON match_labels (labelled_at);
