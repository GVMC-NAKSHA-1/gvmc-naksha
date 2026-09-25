-- Parcel-fabric topology QA: overlaps, gaps and slivers between neighbouring polygons, plus
-- single-geometry repairs, each with the proposed / applied fix.
CREATE TABLE topology_issues (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ward_id     text REFERENCES wards(id),
  source_id   uuid NOT NULL REFERENCES data_sources(id) ON DELETE CASCADE,
  issue_type  text NOT NULL CHECK (issue_type IN ('overlap','gap','sliver','self_intersection','duplicate_vertex')),
  geom        geometry(Geometry, 4326) NOT NULL,        -- the problem area
  area_sqm    numeric(12,2),
  feature_ids uuid[] NOT NULL DEFAULT '{}',
  status      text NOT NULL DEFAULT 'open' CHECK (status IN ('open','auto_fixed','accepted','ignored')),
  fix         jsonb NOT NULL DEFAULT '{}'::jsonb,       -- {action, target_feature_id, ...}
  fixed_geom  geometry(Geometry, 4326),                  -- geometry of the target feature after the fix
  resolved_by text,
  resolved_at timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX topology_issues_source_idx ON topology_issues (source_id, status);
CREATE INDEX topology_issues_ward_idx   ON topology_issues (ward_id, status);
CREATE INDEX topology_issues_geom_idx   ON topology_issues USING GIST (geom);
