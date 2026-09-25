-- GeoAI feature extraction: building footprints derived from drone / ORI / DSM-DTM rasters are
-- stored as their own data source so they flow through matching, conflicts and validation.
ALTER TYPE source_type   ADD VALUE IF NOT EXISTS 'ai_extracted';
-- Scans / rasters with no CRS wait for ground control points instead of failing.
ALTER TYPE source_status ADD VALUE IF NOT EXISTS 'needs_georef';

CREATE TABLE extraction_runs (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ward_id          text REFERENCES wards(id),
  source_id        uuid NOT NULL REFERENCES data_sources(id) ON DELETE CASCADE,
  method           text NOT NULL DEFAULT 'auto' CHECK (method IN ('auto','ndsm','model','classical')),
  method_used      text,                                -- what actually ran after 'auto' resolution
  params           jsonb NOT NULL DEFAULT '{}'::jsonb,
  status           text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','running','done','failed')),
  result_source_id uuid REFERENCES data_sources(id) ON DELETE SET NULL,
  feature_count    int,
  metrics          jsonb NOT NULL DEFAULT '{}'::jsonb,  -- mean height, area stats, mean confidence…
  error            text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  finished_at      timestamptz
);
CREATE INDEX extraction_runs_ward_idx ON extraction_runs (ward_id, created_at DESC);
