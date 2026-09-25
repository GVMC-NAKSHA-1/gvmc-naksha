# Datasets: open-data pack and department data

This folder has two things:

1. **The open-data pack.** A reproducible build of realistic datasets for all 98 GVMC wards, from free sources plus generated land records. It is for demos, testing and evaluation.
2. **The data loader and this preparation guide.** Use them to load real department data (drone ORI/DSM, cadastral maps, revenue records, property-tax GIS…) into NAKSHA GeoIntegrate the same way.

Both load **through the platform's own API**:
- register the upload (`POST /api/sources/upload`)
- PUT the file to object storage
- `POST /api/sources/:id/complete`

Every file therefore goes through the pipeline an officer's upload does: ETL, CRS normalisation, AI extraction, topology QA, matching, conflicts, golden records and validation.

---

## 1. Open-data pack

### What is real and what is generated

| Layer (source type) | Content | Real / generated |
|---|---|---|
| `building_footprint` | Building outlines | **Real**: Microsoft Global ML Building Footprints (default), or Overture Maps (Google + Microsoft + OSM) with `NAKSHA_BUILDINGS=overture`. Floors, heights and use are generated |
| `cadastral` | Land parcels | **Generated**: real OSM streets cut city blocks, and each block is split around its real buildings (Voronoi, trimmed to plot size); empty land becomes vacant plots. ~3 % of parcels carry injected overlaps, gaps, slivers, duplicate vertices and bow-ties. Wards divisible by 3 are delivered in the legacy **Kalianpur 1975 / UTM 44N** datum (EPSG:24344) |
| `municipal_gis` | Property-tax GIS | **Generated** from the parcels: outlines re-digitised 0.5–1.5 m off, different field names (`assess_no`, `owner`, `plinth_sy`…), ~8 % owner-name spelling variants and ~3 % survey-number disagreements. Zipped shapefile in UTM 44N |
| `revenue` (CSV) | Webland-style revenue extract | **Generated**: one row per parcel, with khata no., survey no., owner, extent in sq yd and land class. ~5 % extent disagreements and ~5 % owner changes |
| `revenue` (scanned PDF) | 1-B record of rights | **Generated** and rendered as a noisy, slightly rotated scan, one per ward; read back by OCR |
| `dsm_dtm` | 2-band GeoTIFF: DSM, DTM | **Real terrain** (Copernicus GLO-30) + **generated 2025 buildings** raised to their heights. Relative to 2023, 2 % were demolished, 3 % extended, 2 % raised by one or two floors, and 3 % are new structures. AI extraction runs on it; change detection compares the result against the 2023 survey |
| `utility` | Networks | **Real** OSM power lines, pipelines and drains + **generated** water mains along streets |
| `ground_truth` | GPX field observations | **Generated**: ~2 % of buildings, with ~1.5 m handheld-GPS noise |
| `gnss_cors` | Control points | **Generated**: RTK/CORS points at block corners, CSV in UTM x/y with cm-level noise |
| Ward boundaries | 98 zones | **Generated**: no open dataset publishes GVMC ward boundaries. Zones come from k-means on building centroids (balanced by buildings, as wards are by population), clipped to the built-up area, and named after the most prominent OSM locality inside each. Replace them with the official boundaries using `load-wards --file` |

Every generated source is labelled in its `data_sources.metadata` with `"synthetic": true`, `"dataset": "naksha-open-pack-v1"` and a description. The *Data sources* page shows these layers with a **Synthetic** badge.

**Not in the pack:** `drone_imagery` and `ori`. No open imagery exists at the 2–5 cm needed to extract footprints: satellite imagery is 10 m (Sentinel-2) or cannot be downloaded (commercial basemaps). The synthetic DSM demonstrates the imagery → AI extraction path instead. Real drone ORI loads with the same loader (section 2).

### Answer key
Each ward folder has an `answers.json` with every injected topology defect (by `parcel_id`) and every generated change (by `bldg_id`, or the centroid for new structures). `score` measures the platform against it:
- the **recall** of topology QA
- the recall of change detection

### Build and load

The stack must be running (`docker compose up -d`). The `data` service reuses the worker image, so it needs no extra downloads.

```bash
docker compose --profile data run --rm data all            # everything below, in order
# or step by step:
docker compose --profile data run --rm data fetch          # downloads, cached in data/cache (~15 MB)
docker compose --profile data run --rm data wards          # → data/out/wards.geojson
docker compose --profile data run --rm data build          # → data/out/ward-<id>/  (add --wards 4 for one)
docker compose --profile data run --rm data load-wards --drop-demo
docker compose --profile data run --rm data load           # resumable: already-loaded files are skipped
docker compose --profile data run --rm data wait
docker compose --profile data run --rm data finish         # change detection per ward
docker compose --profile data run --rm data status
docker compose --profile data run --rm data score
```

- Rebuilding gives identical files: every random choice is seeded by ward.
- For faster processing, add workers: `docker compose up -d --scale worker=3`.

Ward-level jobs are safe to run in parallel:
- **A per-ward database lock** serialises the jobs that rewrite a ward.
- **Coalescing:** when a newer job for the same ward is already queued, the older one is skipped.

---

## 2. Loading department data

### Folder layout
One folder per ward, each with a `manifest.json` listing its files:

```
my-data/
  ward-12/
    manifest.json
    cadastral_w12.zip
    revenue_w12.csv
    ori_w12.tif
```

```json
{
  "ward_id": "12",
  "files": [
    {"path": "cadastral_w12.zip", "type": "cadastral", "crs": "EPSG:24344", "captured_at": "2019-06-01",
     "description": "Survey of India cadastral sheet 65 O/2, digitised 2019"},
    {"path": "revenue_w12.csv", "type": "revenue", "captured_at": "2024-03-31"},
    {"path": "ori_w12.tif", "type": "ori", "captured_at": "2025-01-20"}
  ]
}
```

`manifest.example.json` is a complete template. Then:

```bash
docker compose --profile data run --rm -v /path/to/my-data:/in data load --dir /in
docker compose --profile data run --rm data load-wards --file /in/wards.geojson   # official ward boundaries
```

`wards.geojson` needs `id` and `name` properties on each polygon.

### Formats per source type

| `type` | Accepted formats | Notes |
|---|---|---|
| `drone_imagery`, `ori` | GeoTIFF (RGB) | Must be geo-referenced (embedded CRS or `crs` in the manifest). A scan or PNG without a CRS waits for ground control points in *Geo-referencing & CRS* |
| `dsm_dtm` | GeoTIFF, 2 bands (DSM, DTM) or DSM only | With a DSM only, the terrain is estimated by a morphological ground filter |
| `cadastral`, `municipal_gis`, `building_footprint` | **Zipped shapefile** (`.shp .shx .dbf .prj` in one `.zip`, one layer per zip) or GeoJSON | Polygons |
| `utility` | Zipped shapefile or GeoJSON | Lines |
| `revenue` | **CSV with coordinates**, GeoJSON, or a **scanned PDF/PNG** (`"scanned": true`, which goes to OCR) | A CSV must have a longitude and a latitude column; see below |
| `ground_truth` | GPX waypoints or CSV with coordinates | |
| `gnss_cors` | CSV with coordinates | Projected x/y is fine; declare the `crs` |

### Coordinate reference systems
- **GeoJSON** without a `crs` member is WGS84 (RFC 7946).
- **Shapefiles** carry their CRS in the `.prj`. Without a `.prj`, the manifest must give `crs`.
- **CSV:** columns named `lon`/`lng`/`longitude`/`x` and `lat`/`latitude`/`y` (any case). WGS84 is assumed unless the manifest declares another `crs` (e.g. `EPSG:32644` for UTM x/y). Rows with blank coordinates are skipped.
- **Legacy Survey of India sheets:** use `EPSG:24344` / `EPSG:24345` (Kalianpur 1975 / UTM 44N / 45N). The datum shift is applied.

### Attribute names
Any field names work: *Attribute mapping* aligns them across departments (AI-assisted, with a name-matching fallback). Matching, conflict detection and golden records work best when these recognised names are used where they apply:

| Meaning | Recognised names |
|---|---|
| Parcel identifier | `parcel_id`, `survey_no`, `khata_no`, `property_tax_id`, `assessment_no` |
| Owner | `owner_name` |
| Area | `area_sqm` (square metres); state other units in the field name, e.g. `extent_sqyd` |
| Land use | `land_use` |
| Building | `bldg_id`, `floors`, `height_m` |

### Size and practical limits
- One file per ward per source type keeps each processing job a manageable size.
- Rasters larger than 4096 px on the longest side are read at reduced resolution for extraction.
- Uploads go straight from the loader to object storage. Each file must fit a single PUT: 5 GB on Cloudflare R2.

---

## 3. Sources and licences
See [ATTRIBUTION.md](ATTRIBUTION.md).
