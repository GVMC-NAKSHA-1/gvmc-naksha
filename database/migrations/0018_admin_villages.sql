-- Official village boundaries (Survey of India → ORGI harmonised villages) with LGD codes,
-- loaded by `python -m naksha_data load-villages` for the districts GVMC spans.
-- LGD codes are the join key to revenue records (Webland) and other state datasets.

CREATE TABLE IF NOT EXISTS villages (
  vill_lgd    text NOT NULL,
  name        text NOT NULL,
  category    text,                                   -- RURAL / URBAN / OTHERS
  mandal      text,
  mandal_lgd  text NOT NULL,
  district    text,
  dist_lgd    text,
  geom        geometry(MultiPolygon, 4326) NOT NULL,
  -- Urban bodies such as GVMC (LGD 802947) are split into one part per mandal they span.
  PRIMARY KEY (vill_lgd, mandal_lgd)
);
CREATE INDEX IF NOT EXISTS villages_geom_idx ON villages USING GIST (geom);

-- Golden records with the village / mandal they fall in (by a point inside the parcel).
CREATE OR REPLACE VIEW harmonized_parcels_admin AS
SELECT hp.id AS parcel_id, hp.ward_id, v.vill_lgd, v.name AS village, v.mandal, v.mandal_lgd, v.district, v.dist_lgd
FROM harmonized_parcels hp
LEFT JOIN LATERAL (
  SELECT * FROM villages v WHERE ST_Contains(v.geom, ST_PointOnSurface(hp.geom)) LIMIT 1
) v ON true;
