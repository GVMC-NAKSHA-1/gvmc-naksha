-- Keyless demo: two overlapping multi-source datasets for Ward 4 so the harmonization
-- pipeline (match -> conflict -> assemble) produces real output with no R2 / uploads.
-- 4 cadastral parcels + 4 building footprints, deliberately overlapping, with a couple of
-- attribute disagreements to exercise the conflicts module.

INSERT INTO data_sources (id, type, ward_id, r2_key, original_name, crs, scanned, status, metadata)
VALUES
  ('11111111-1111-4111-8111-111111111111', 'cadastral', '4', 'demo/cadastral_ward4.geojson',
   'cadastral_ward4.geojson', 'EPSG:4326', false, 'ready',
   '{"fields": ["area_sqm", "khata_no", "owner_name"], "feature_count": 4, "demo": true}'::jsonb),
  ('22222222-2222-4222-8222-222222222222', 'building_footprint', '4', 'demo/footprints_ward4.geojson',
   'footprints_ward4.geojson', 'EPSG:4326', false, 'ready',
   '{"fields": ["area_sqm", "height_m", "owner_name"], "feature_count": 4, "demo": true}'::jsonb)
ON CONFLICT (id) DO NOTHING;

-- Cadastral parcels (≈33 m squares around 17.700, 83.215)
INSERT INTO source_features (source_id, geom, properties) VALUES
  ('11111111-1111-4111-8111-111111111111',
   ST_SetSRID(ST_GeomFromText('POLYGON((83.2150 17.7000,83.2153 17.7000,83.2153 17.7003,83.2150 17.7003,83.2150 17.7000))'),4326),
   '{"khata_no":"K-401","owner_name":"Ramesh Rao","area_sqm":110}'::jsonb),
  ('11111111-1111-4111-8111-111111111111',
   ST_SetSRID(ST_GeomFromText('POLYGON((83.2156 17.7000,83.2159 17.7000,83.2159 17.7003,83.2156 17.7003,83.2156 17.7000))'),4326),
   '{"khata_no":"K-402","owner_name":"Sita Devi","area_sqm":118}'::jsonb),
  ('11111111-1111-4111-8111-111111111111',
   ST_SetSRID(ST_GeomFromText('POLYGON((83.2150 17.7006,83.2153 17.7006,83.2153 17.7009,83.2150 17.7009,83.2150 17.7006))'),4326),
   '{"khata_no":"K-403","owner_name":"Abdul Khan","area_sqm":125}'::jsonb),
  ('11111111-1111-4111-8111-111111111111',
   ST_SetSRID(ST_GeomFromText('POLYGON((83.2156 17.7006,83.2159 17.7006,83.2159 17.7009,83.2156 17.7009,83.2156 17.7006))'),4326),
   '{"khata_no":"K-404","owner_name":"Lakshmi N","area_sqm":132}'::jsonb);

-- Building footprints — mostly overlapping the parcels (high IoU); #2 disagrees on owner,
-- #4 disagrees on area.
INSERT INTO source_features (source_id, geom, properties) VALUES
  ('22222222-2222-4222-8222-222222222222',
   ST_SetSRID(ST_GeomFromText('POLYGON((83.21502 17.70002,83.21532 17.70002,83.21532 17.70032,83.21502 17.70032,83.21502 17.70002))'),4326),
   '{"owner_name":"Ramesh Rao","height_m":8.5,"area_sqm":108}'::jsonb),
  ('22222222-2222-4222-8222-222222222222',
   ST_SetSRID(ST_GeomFromText('POLYGON((83.21562 17.70002,83.21592 17.70002,83.21592 17.70032,83.21562 17.70032,83.21562 17.70002))'),4326),
   '{"owner_name":"S. Devi (occupant)","height_m":6.0,"area_sqm":117}'::jsonb),
  ('22222222-2222-4222-8222-222222222222',
   ST_SetSRID(ST_GeomFromText('POLYGON((83.21502 17.70062,83.21532 17.70062,83.21532 17.70092,83.21502 17.70092,83.21502 17.70062))'),4326),
   '{"owner_name":"Abdul Khan","height_m":9.2,"area_sqm":124}'::jsonb),
  ('22222222-2222-4222-8222-222222222222',
   ST_SetSRID(ST_GeomFromText('POLYGON((83.21562 17.70062,83.21592 17.70062,83.21592 17.70092,83.21562 17.70092,83.21562 17.70062))'),4326),
   '{"owner_name":"Lakshmi N","height_m":7.4,"area_sqm":205}'::jsonb);
