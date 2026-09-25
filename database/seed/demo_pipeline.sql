-- Demo data for the PS 26013 pipeline features (ward 4, keyless):
--   * a cadastral fabric with deliberate topology errors (overlap, gap, sliver) -> Topology QA
--   * building footprints from a 2023 survey and AI-extracted footprints from 2025 imagery
--     that differ (new, demolished, extended, raised) -> Change detection, Validation & sync
-- Loaded once by migrate.sh (guarded by the fixed source ids below).

INSERT INTO data_sources (id, type, ward_id, r2_key, original_name, crs, captured_at, scanned, status, metadata) VALUES
  ('33333333-3333-4333-8333-333333333333', 'cadastral', '4', 'demo/cadastral_fabric_ward4.geojson', 'cadastral_fabric_ward4.geojson', 'EPSG:4326', '2019-06-01', false, 'ready',
   '{"fields": ["parcel_id","survey_no","owner_name","area_sqm","land_use"], "feature_count": 6, "demo": true}'::jsonb),
  ('44444444-4444-4444-8444-444444444444', 'building_footprint', '4', 'demo/footprints_2023_ward4.geojson', 'footprints_survey_2023_ward4.geojson', 'EPSG:4326', '2023-03-15', false, 'ready',
   '{"fields": ["bldg_id","floors","height_m"], "feature_count": 6, "demo": true, "epoch": 2023}'::jsonb),
  ('55555555-5555-4555-8555-555555555555', 'ai_extracted', '4', 'demo/ai_footprints_2025_ward4.geojson', 'ai_footprints_ori_2025_ward4.geojson', 'EPSG:4326', '2025-11-20', false, 'ready',
   '{"fields": ["confidence","height_m","area_sqm","method"], "feature_count": 8, "demo": true, "epoch": 2025, "method": "ndsm"}'::jsonb)
ON CONFLICT (id) DO NOTHING;

INSERT INTO source_features (source_id, geom, properties) VALUES
  ('33333333-3333-4333-8333-333333333333', ST_SetSRID(ST_GeomFromText('POLYGON((83.2165000 17.6975000,83.2167829 17.6975000,83.2167829 17.6977261,83.2165000 17.6977261,83.2165000 17.6975000))'),4326), '{"parcel_id": "W4-F01", "survey_no": "210/1", "owner_name": "P. Venkatesh", "area_sqm": 750, "land_use": "residential"}'::jsonb),
  ('33333333-3333-4333-8333-333333333333', ST_SetSRID(ST_GeomFromText('POLYGON((83.2167659 17.6975000,83.2170658 17.6975000,83.2170658 17.6977261,83.2167659 17.6977261,83.2167659 17.6975000))'),4326), '{"parcel_id": "W4-F02", "survey_no": "211/1", "owner_name": "R. Kumari", "area_sqm": 795, "land_use": "residential"}'::jsonb),
  ('33333333-3333-4333-8333-333333333333', ST_SetSRID(ST_GeomFromText('POLYGON((83.2170658 17.6975000,83.2173487 17.6975000,83.2173487 17.6977261,83.2170658 17.6977261,83.2170658 17.6975000))'),4326), '{"parcel_id": "W4-F03", "survey_no": "212/1", "owner_name": "S. Naidu", "area_sqm": 750, "land_use": "commercial"}'::jsonb),
  ('33333333-3333-4333-8333-333333333333', ST_SetSRID(ST_GeomFromText('POLYGON((83.2165000 17.6977261,83.2167829 17.6977261,83.2167829 17.6979522,83.2165000 17.6979522,83.2165000 17.6977261))'),4326), '{"parcel_id": "W4-F04", "survey_no": "213/1", "owner_name": "A. Rahman", "area_sqm": 750, "land_use": "residential"}'::jsonb),
  ('33333333-3333-4333-8333-333333333333', ST_SetSRID(ST_GeomFromText('POLYGON((83.2167914 17.6977261,83.2170658 17.6977261,83.2170658 17.6979522,83.2167914 17.6979522,83.2167914 17.6977261))'),4326), '{"parcel_id": "W4-F05", "survey_no": "214/1", "owner_name": "K. Swathi", "area_sqm": 728, "land_use": "mixed_use"}'::jsonb),
  ('33333333-3333-4333-8333-333333333333', ST_SetSRID(ST_GeomFromText('POLYGON((83.2170691 17.6977261,83.2173487 17.6977261,83.2173487 17.6979522,83.2170691 17.6979522,83.2170691 17.6977261))'),4326), '{"parcel_id": "W4-F06", "survey_no": "215/1", "owner_name": "M. Prasad", "area_sqm": 741, "land_use": "residential"}'::jsonb);

INSERT INTO source_features (source_id, geom, properties) VALUES
  ('44444444-4444-4444-8444-444444444444', ST_SetSRID(ST_GeomFromText('POLYGON((83.2165566 17.6975452,83.2167074 17.6975452,83.2167074 17.6976628,83.2165566 17.6976628,83.2165566 17.6975452))'),4326), '{"bldg_id": "B23-1", "floors": 1, "height_m": 3.2}'::jsonb),
  ('44444444-4444-4444-8444-444444444444', ST_SetSRID(ST_GeomFromText('POLYGON((83.2168395 17.6975452,83.2169903 17.6975452,83.2169903 17.6976628,83.2168395 17.6976628,83.2168395 17.6975452))'),4326), '{"bldg_id": "B23-2", "floors": 2, "height_m": 6.4}'::jsonb),
  ('44444444-4444-4444-8444-444444444444', ST_SetSRID(ST_GeomFromText('POLYGON((83.2171223 17.6975452,83.2172732 17.6975452,83.2172732 17.6976628,83.2171223 17.6976628,83.2171223 17.6975452))'),4326), '{"bldg_id": "B23-3", "floors": 3, "height_m": 9.600000000000001}'::jsonb),
  ('44444444-4444-4444-8444-444444444444', ST_SetSRID(ST_GeomFromText('POLYGON((83.2165566 17.6977713,83.2167074 17.6977713,83.2167074 17.6978889,83.2165566 17.6978889,83.2165566 17.6977713))'),4326), '{"bldg_id": "B23-4", "floors": 1, "height_m": 3.2}'::jsonb),
  ('44444444-4444-4444-8444-444444444444', ST_SetSRID(ST_GeomFromText('POLYGON((83.2168395 17.6977713,83.2169903 17.6977713,83.2169903 17.6978889,83.2168395 17.6978889,83.2168395 17.6977713))'),4326), '{"bldg_id": "B23-5", "floors": 2, "height_m": 6.4}'::jsonb),
  ('44444444-4444-4444-8444-444444444444', ST_SetSRID(ST_GeomFromText('POLYGON((83.2171223 17.6977713,83.2172732 17.6977713,83.2172732 17.6978889,83.2171223 17.6978889,83.2171223 17.6977713))'),4326), '{"bldg_id": "B23-6", "floors": 3, "height_m": 9.600000000000001}'::jsonb);

INSERT INTO source_features (source_id, geom, properties) VALUES
  ('55555555-5555-4555-8555-555555555555', ST_SetSRID(ST_GeomFromText('POLYGON((83.2165603 17.6975479,83.2167112 17.6975479,83.2167112 17.6976655,83.2165603 17.6976655,83.2165603 17.6975479))'),4326), '{"confidence": 0.86, "height_m": 3.2, "area_sqm": 208, "method": "ndsm"}'::jsonb),
  ('55555555-5555-4555-8555-555555555555', ST_SetSRID(ST_GeomFromText('POLYGON((83.2168432 17.6975479,83.2170620 17.6975479,83.2170620 17.6976655,83.2168432 17.6976655,83.2168432 17.6975479))'),4326), '{"confidence": 0.88, "height_m": 6.4, "area_sqm": 302, "method": "ndsm"}'::jsonb),
  ('55555555-5555-4555-8555-555555555555', ST_SetSRID(ST_GeomFromText('POLYGON((83.2165603 17.6977740,83.2167112 17.6977740,83.2167112 17.6978916,83.2165603 17.6978916,83.2165603 17.6977740))'),4326), '{"confidence": 0.92, "height_m": 9.6, "area_sqm": 208, "method": "ndsm"}'::jsonb),
  ('55555555-5555-4555-8555-555555555555', ST_SetSRID(ST_GeomFromText('POLYGON((83.2168432 17.6977740,83.2169941 17.6977740,83.2169941 17.6978916,83.2168432 17.6978916,83.2168432 17.6977740))'),4326), '{"confidence": 0.94, "height_m": 6.4, "area_sqm": 208, "method": "ndsm"}'::jsonb),
  ('55555555-5555-4555-8555-555555555555', ST_SetSRID(ST_GeomFromText('POLYGON((83.2171261 17.6977740,83.2172770 17.6977740,83.2172770 17.6978916,83.2171261 17.6978916,83.2171261 17.6977740))'),4326), '{"confidence": 0.96, "height_m": 9.6, "area_sqm": 208, "method": "ndsm"}'::jsonb),
  ('55555555-5555-4555-8555-555555555555', ST_SetSRID(ST_GeomFromText('POLYGON((83.2172544 17.6976628,83.2173298 17.6976628,83.2173298 17.6977080,83.2172544 17.6977080,83.2172544 17.6976628))'),4326), '{"confidence": 0.78, "height_m": 3.4, "area_sqm": 40, "method": "ndsm"}'::jsonb),
  ('55555555-5555-4555-8555-555555555555', ST_SetSRID(ST_GeomFromText('POLYGON((83.2167263 17.6977532,83.2168395 17.6977532,83.2168395 17.6978346,83.2167263 17.6978346,83.2167263 17.6977532))'),4326), '{"confidence": 0.83, "height_m": 6.1, "area_sqm": 108, "method": "ndsm"}'::jsonb),
  ('55555555-5555-4555-8555-555555555555', ST_SetSRID(ST_GeomFromText('POLYGON((83.2174241 17.6977623,83.2175184 17.6977623,83.2175184 17.6978437,83.2174241 17.6978437,83.2174241 17.6977623))'),4326), '{"confidence": 0.74, "height_m": 3.0, "area_sqm": 90, "method": "ndsm"}'::jsonb);

