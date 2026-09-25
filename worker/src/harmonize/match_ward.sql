-- worker/src/harmonize/match_ward.sql
-- Candidate pairs between features of *different* source types in one ward, scored by polygon IoU
-- or point-to-centroid distance. match.py then keeps a one-to-one selection per source pair.
--
-- The join prunes with a plain-geometry ST_DWithin so the GiST index on source_features.geom is
-- used (a ::geography cast cannot use it). 0.0003° ≈ 33 m at Indian latitudes, which covers both
-- rules below: polygons must intersect for IoU > 0, and points count up to 25 m from a centroid
-- (a point within 25 m of a centroid is within 25 m of the polygon).
WITH pairs AS (
  SELECT a.id AS a_id, b.id AS b_id, da.type AS a_type, db.type AS b_type,
         a.source_id AS a_source, b.source_id AS b_source,
         a.properties AS a_props, b.properties AS b_props,
         da.captured_at AS a_captured, db.captured_at AS b_captured,
         CASE WHEN ST_Dimension(a.geom) = 2 AND ST_Dimension(b.geom) = 2 AND ST_Intersects(a.geom, b.geom)
              THEN ST_Area(ST_Intersection(a.geom, b.geom))
                   / NULLIF(ST_Area(ST_Union(a.geom, b.geom)), 0)
              WHEN ST_Dimension(a.geom) = 2 AND ST_Dimension(b.geom) = 2 THEN 0
         END AS iou,
         CASE WHEN ST_Dimension(a.geom) = 0 OR ST_Dimension(b.geom) = 0
              THEN ST_Distance(ST_Centroid(a.geom)::geography, ST_Centroid(b.geom)::geography)
         END AS dist_m
  FROM data_sources da
  JOIN source_features a ON a.source_id = da.id
  JOIN source_features b ON b.id > a.id AND ST_DWithin(a.geom, b.geom, 0.0003)   -- GiST-indexed prune
  JOIN data_sources   db ON db.id = b.source_id
  WHERE da.ward_id = %(ward)s AND db.ward_id = %(ward)s AND da.type <> db.type
    AND da.status = 'ready' AND db.status = 'ready'
    -- raster extents are context; utility networks and GNSS control points are reference layers,
    -- not records of a parcel or a building
    AND da.type NOT IN ('ori','drone_imagery','dsm_dtm','utility','gnss_cors')
    AND db.type NOT IN ('ori','drone_imagery','dsm_dtm','utility','gnss_cors')
    AND ST_Dimension(a.geom) <> 1 AND ST_Dimension(b.geom) <> 1
)
SELECT *,
       round((100 * COALESCE(iou, GREATEST(0, 1 - dist_m / 25.0)))::numeric, 2) AS match_score
FROM pairs
WHERE COALESCE(iou, 0) >= 0.30 OR COALESCE(dist_m, 999) <= 25;
