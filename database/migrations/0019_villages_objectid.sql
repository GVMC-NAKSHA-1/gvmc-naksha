-- Key villages by the source OBJECTID. (vill_lgd, mandal_lgd) is not unique: reserved forests
-- have no LGD code, and a village split into urban and rural parts keeps one code for both.
-- The table only holds data reloaded by `python -m naksha_data load-villages`, so it is emptied.

TRUNCATE villages;
ALTER TABLE villages DROP CONSTRAINT IF EXISTS villages_pkey;
ALTER TABLE villages ADD COLUMN soi_objectid int NOT NULL;
ALTER TABLE villages ADD PRIMARY KEY (soi_objectid);
ALTER TABLE villages ALTER COLUMN vill_lgd DROP NOT NULL;     -- NULL for reserved forests
ALTER TABLE villages ALTER COLUMN mandal_lgd DROP NOT NULL;
CREATE INDEX IF NOT EXISTS villages_lgd_idx ON villages (vill_lgd, mandal_lgd);
