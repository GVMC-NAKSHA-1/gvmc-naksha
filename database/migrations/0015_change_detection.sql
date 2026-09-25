-- Multi-epoch change detection: compare two footprint layers (e.g. 2023 survey vs 2025 AI
-- extraction) and classify every structural change.
CREATE TABLE change_runs (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ward_id            text REFERENCES wards(id),
  baseline_source_id uuid NOT NULL REFERENCES data_sources(id) ON DELETE CASCADE,
  current_source_id  uuid NOT NULL REFERENCES data_sources(id) ON DELETE CASCADE,
  params             jsonb NOT NULL DEFAULT '{}'::jsonb,
  status             text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','running','done','failed')),
  summary            jsonb NOT NULL DEFAULT '{}'::jsonb,  -- counts per change_type
  error              text,
  created_at         timestamptz NOT NULL DEFAULT now(),
  finished_at        timestamptz
);
CREATE INDEX change_runs_ward_idx ON change_runs (ward_id, created_at DESC);

CREATE TABLE change_detections (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id        uuid NOT NULL REFERENCES change_runs(id) ON DELETE CASCADE,
  ward_id       text REFERENCES wards(id),
  change_type   text NOT NULL CHECK (change_type IN ('new_structure','demolished','extension','reduction','vertical_extension')),
  geom          geometry(Geometry, 4326) NOT NULL,      -- current geometry (baseline for demolished)
  geom_before   geometry(Geometry, 4326),
  baseline_feature_id uuid,
  current_feature_id  uuid,
  area_before   numeric(12,2),
  area_after    numeric(12,2),
  height_before numeric(8,2),
  height_after  numeric(8,2),
  confidence    numeric(5,4) NOT NULL,
  status        text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','confirmed','false_positive')),
  verified_by   text,
  verified_at   timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX change_detections_run_idx  ON change_detections (run_id);
CREATE INDEX change_detections_ward_idx ON change_detections (ward_id, status);
CREATE INDEX change_detections_geom_idx ON change_detections USING GIST (geom);
