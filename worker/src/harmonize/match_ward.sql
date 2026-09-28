-- worker/src/harmonize/match_ward.sql
-- Candidate pairs between features of *different* source types in one ward, scored by polygon IoU
-- or point-to-centroid distance. match.py then keeps a one-to-one selection per source pair.
--
-- The join prunes with a plain-geometry ST_DWithin so the GiST index on source_features.geom is
-- used (a ::geography cast cannot use it). 0.0003° ≈ 33 m at Indian latitudes, which covers both
-- rules below: polygons must intersect for IoU > 0, and points count up to 25 m from a centroid
-- (a point within 25 m of a centroid is within 25 m of the polygon).
--
-- area/perimeter/Hausdorff feed the ML matcher (features.py). They are computed only for pairs that
-- pass the rules, in metres (geography for area/perimeter; UTM 44N, which covers GVMC, for Hausdorff).
WITH pairs AS (
  SELECT a.id AS a_id, b.id AS b_id, da.type AS a_type, db.type AS b_type,
         a.source_id AS a_source, b.source_id AS b_source,
         a.properties AS a_props, b.properties AS b_props,
         da.captured_at AS a_captured, db.captured_at AS b_captured,
         a.geom AS a_geom, b.geom AS b_geom,
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
SELECT a_id, b_id, a_type, b_type, a_source, b_source, a_props, b_props, a_captured, b_captured,
       iou, dist_m,
       round((100 * COALESCE(iou, GREATEST(0, 1 - dist_m / 25.0)))::numeric, 2) AS match_score,
       CASE WHEN ST_Dimension(a_geom) = 2 THEN ST_Area(a_geom::geography) END      AS area_a,
       CASE WHEN ST_Dimension(b_geom) = 2 THEN ST_Area(b_geom::geography) END      AS area_b,
       CASE WHEN ST_Dimension(a_geom) = 2 THEN ST_Perimeter(a_geom::geography) END AS perim_a,
       CASE WHEN ST_Dimension(b_geom) = 2 THEN ST_Perimeter(b_geom::geography) END AS perim_b,
       CASE WHEN iou IS NOT NULL
            THEN ST_HausdorffDistance(ST_Transform(a_geom, 32644), ST_Transform(b_geom, 32644)) END AS hausdorff_m
FROM pairs
WHERE COALESCE(iou, 0) >= 0.30 OR COALESCE(dist_m, 999) <= 25;
