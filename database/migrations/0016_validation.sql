-- Data-quality validation per source + synchronisation findings between AI-extracted /
-- footprint structures and the cadastral fabric.
CREATE TABLE validation_reports (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ward_id    text REFERENCES wards(id),
  source_id  uuid REFERENCES data_sources(id) ON DELETE CASCADE,   -- NULL = ward-level summary
  score      numeric(5,2) NOT NULL,                                 -- 0-100
  checks     jsonb NOT NULL DEFAULT '[]'::jsonb,                    -- [{key,label,value,passed,weight}]
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX validation_reports_ward_idx ON validation_reports (ward_id, created_at DESC);

CREATE TABLE sync_findings (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ward_id      text REFERENCES wards(id),
  report_id    uuid REFERENCES validation_reports(id) ON DELETE CASCADE,
  finding_type text NOT NULL CHECK (finding_type IN ('unregistered_structure','encroachment','vacant_parcel','attribute_drift')),
  geom         geometry(Geometry, 4326) NOT NULL,
  feature_ids  uuid[] NOT NULL DEFAULT '{}',
  detail       jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX sync_findings_ward_idx ON sync_findings (ward_id, finding_type);
CREATE INDEX sync_findings_geom_idx ON sync_findings USING GIST (geom);
