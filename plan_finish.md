# NAKSHA GeoIntegrate — Final Solution Document

**Problem Statement 26013 — Automated Integration and Intelligent Harmonization of Multi-source Geospatial Data for Urban Land Record Management**
Ministry of Rural Development · Department of Land Resources (DoLR) · Category: Software · Theme: Smart Automation

This document describes the whole platform: the problem, how each requirement is solved, the architecture, the algorithms, the tech stack (and why it was chosen), development, testing and deployment, and the known limits.

---

## Table of contents
1. [The problem](#1-the-problem)
2. [Our solution at a glance](#2-our-solution-at-a-glance)
3. [Requirement → feature traceability](#3-requirement--feature-traceability)
4. [System architecture](#4-system-architecture)
5. [End-to-end pipeline (how data flows)](#5-end-to-end-pipeline-how-data-flows)
6. [Algorithms and methods](#6-algorithms-and-methods)
7. [Data model](#7-data-model)
8. [API reference](#8-api-reference)
9. [User interface & UX](#9-user-interface--ux)
10. [Tech stack and why we chose it](#10-tech-stack-and-why-we-chose-it)
11. [Repository structure](#11-repository-structure)
12. [Development setup](#12-development-setup)
13. [Testing & verification status](#13-testing--verification-status)
14. [Deployment](#14-deployment)
15. [Security, governance & data protection](#15-security-governance--data-protection)
16. [Expected outcomes and how we measure them](#16-expected-outcomes-and-how-we-measure-them)
17. [Known limitations & future work](#17-known-limitations--future-work)
18. [Glossary](#18-glossary)

---

## 1. The problem

Urban land administration depends on many spatial and non-spatial datasets produced by different departments and survey methods. The NAKSHA programme now generates large volumes of:

| Source | Typical format | What it contributes |
|---|---|---|
| Drone imagery | GeoTIFF (RGB, 2–5 cm) | Current ground truth of roofs and structures |
| Orthorectified imagery (ORI) | GeoTIFF | Map-accurate imagery for feature extraction |
| DSM / DTM | GeoTIFF (elevation) | Building heights (nDSM = DSM − DTM) |
| Existing cadastral maps | Shapefile / GeoJSON / scanned sheets | Legal parcel boundaries |
| Revenue records | CSV, scanned PDFs | Ownership, khata, survey numbers, extent |
| Municipal GIS layers | GeoJSON / Shapefile | Property-tax parcels, assessment IDs |
| Utility network data | GeoJSON (lines) | Water / sewer / power alignments |
| Ground Truthing (GT) | GPX / CSV points | Field-verified observations |
| GNSS / CORS survey | CSV control points | High-accuracy reference coordinates |
| Building footprints | GeoJSON polygons | Structure outlines (surveyed or third-party) |

**Today these are merged by hand in desktop GIS.** That is slow, error-prone and inconsistent:
- the datasets use different coordinate systems (WGS84, UTM, legacy Kalianpur/Everest)
- scanned maps have no coordinates at all
- parcel fabrics overlap or leave gaps
- each department names the same attribute differently
- nobody can say how reliable a merged record is

**The PS asks for** an AI-enabled platform that automatically integrates, harmonizes, validates and synchronizes these datasets with **AI-generated feature-extraction outputs**. It must include:
- AI/ML spatial matching
- automated topology correction
- intelligent attribute mapping
- geo-referencing and coordinate transformation
- change detection
- a spatial conflict-resolution framework
- confidence scoring

**Expected outcomes:**
- reduce manual GIS effort
- improve accuracy and consistency of land records
- enable inter-departmental data exchange
- accelerate cadastral finalisation
- improve interoperability
- support standardised digital land governance

---

## 2. Our solution at a glance

**NAKSHA GeoIntegrate** is a web platform with three parts:

- **React Web-GIS workbench** (the frontend): officers upload data, review what the automation produced, and make the decisions a machine should not make alone.
- **NestJS REST API**: the system of record, and an **OGC API – Features** endpoint for other departments.
- **Python geo-processing worker**: runs every heavy step (ETL, GeoAI extraction, topology repair, matching, conflict detection, golden-record assembly, change detection, validation) as queued, tracked jobs.

The pipeline is **fully automated and chained**. Uploading a file is enough:

```
upload → CRS normalisation + geometry repair → (raster) AI footprint extraction / (polygon) topology QA
       → spatial matching + confidence → conflict detection → golden-record assembly → validation & sync
```

Humans stay in the loop only where judgement is needed. They:
- place control points on old scans
- accept or ignore topology fixes
- resolve conflicts
- confirm detected changes
- approve attribute mappings

Every automated job and every human decision is logged.

---

## 3. Requirement → feature traceability

| PS requirement | Where it is implemented | UI page |
|---|---|---|
| Integration of **drone imagery, ORI, DSM/DTM** | `worker/src/ingest/adapters.py` (GeoTIFF footprint adapter), `extract/footprints.py` | Data sources, AI feature extraction |
| **Cadastral maps, municipal GIS, utility, building footprints** | vector adapter (GeoJSON / Shapefile) | Data sources, Integration map |
| **Revenue records** (incl. scanned) | vector/CSV adapter + OCR `ocr/digitize.py` (Tesseract + OpenCV) | Data sources (OCR fields) |
| **Ground truthing, GNSS/CORS** | point adapter (GPX / CSV) | Data sources, Integration map |
| **AI/ML-based spatial matching** | `harmonize/match.py` + `match_ward.sql` (PostGIS) + `harmonize/scoring.py` | Spatial matching |
| **Automated topology correction** | single geometry: `spatial/topology.py`; parcel fabric: `spatial/topology_fabric.py`; accept/apply: `backend/src/topology` | Topology QA |
| **Intelligent attribute mapping** | LLM field mapping `backend/src/llm` + `worker/harmonize/schema_map.py`, used by matching & assembly | Attribute mapping |
| **Geo-referencing & coordinate transformation engine** | `worker/src/georef/gcp.py`, `backend/src/georef/affine.ts`, `backend/src/crs` (proj4), `spatial/geo_transform.py` (pyproj) | Geo-referencing & CRS |
| **Change detection mechanisms** | multi-epoch: `worker/src/change/epochs.py`; satellite NDBI alerts (`properties`) | Change detection |
| **Spatial conflict resolution framework** | `harmonize/conflicts.py` + `backend/src/conflicts` + golden-record reliability rules | Conflicts, Golden records |
| **Confidence scoring for integrated outputs** | per match (`scoring.py`), per golden record (`assemble.py`), per AI footprint (`footprints.py`), per change | Matching, Golden records, Extraction, Change |
| **Synchronising with AI-generated feature extraction outputs** | `ai_extracted` source type → matched, validated and synced (`validate/report.py`) | Validation & sync |
| **Validation** | `validate/report.py` (quality rules + sync findings) | Validation & sync |
| Reduce manual effort / accelerate finalisation | automation chain + readiness (`harmonized/readiness.ts`) | Command centre, Golden records |
| Inter-departmental exchange / interoperability | OGC API – Features (`backend/src/ogc`), GeoJSON + GeoPackage export | Data exchange (OGC) |
| Standardised digital land governance | audit trail, job log, role-based access | Activity log |
| ETL automation, cloud, API integration | Redis job queue + tracked `pipeline_jobs`, S3-compatible storage, REST | Pipeline activity drawer |

---

## 4. System architecture

```
                 ┌──────────────────────────────────────────────────────────────┐
  Browser        │  React 18 + Vite SPA (Tailwind, Redux Toolkit, MapLibre GL)  │
  (officers)     │  Command centre · Sources · Geo-ref · Extraction · Topology   │
                 │  Map · Matching · Attributes · Conflicts · Validation ·      │
                 │  Change · Golden records · OGC exchange · Activity           │
                 └───────────────┬──────────────────────────────┬───────────────┘
                     REST/JSON   │                               │ presigned PUT/GET
                                 ▼                               ▼
                 ┌───────────────────────────────┐   ┌───────────────────────────┐
  Other depts →  │ NestJS API (TypeScript)       │   │ Object storage (S3 API)   │
  QGIS/ArcGIS    │ auth guard · validation ·     │   │ Cloudflare R2 / MinIO     │
  via OGC API    │ OGC API–Features · proj4 CRS  │   │ raw uploads · previews ·  │
                 │ GCP solver · readiness · audit│   │ GeoTIFFs · exports        │
                 └──────┬───────────────┬────────┘   └──────────────▲────────────┘
                        │ SQL           │ LPUSH job + pipeline_jobs  │ download/upload
                        ▼               ▼                            │
                 ┌──────────────┐  ┌──────────┐   BRPOP   ┌──────────┴────────────────┐
                 │ PostgreSQL + │◄─┤  Redis   ├──────────►│ Python worker             │
                 │ PostGIS      │  │  queue   │           │ ETL · GeoAI · topology ·  │
                 │ (spatial DB) │◄─────────────────────────┤ matching · conflicts ·    │
                 └──────────────┘        SQL / PostGIS     │ assembly · change · valid.│
                                                           └───────────────────────────┘
       Optional: Supabase Auth (JWT) · Groq LLM (attribute mapping, explanations) · ONNX model
```

**Design principles:**
- **The API stays thin and synchronous; heavy work goes to the worker.** Every job is recorded in `pipeline_jobs` (queued → running → done/failed, with up to 3 retries), so the UI can show live progress.
- **The database is the integration hub.** All geometries are stored once, normalised to EPSG:4326, and indexed with GiST. Metric operations use `geography` or a per-ward UTM projection.
- **Every AI output is just another source.** Footprints extracted by the AI become an `ai_extracted` data source, so they go through the same matching, conflict, validation and export machinery as surveyed data. This is how "synchronising with AI-generated feature extraction outputs" is achieved.
- **Automation with review.** Fixes and decisions are proposed with a confidence and applied automatically only when configured (e.g. `autoFix`). Otherwise an officer accepts them.

---

## 5. End-to-end pipeline (how data flows)

| # | Stage | Trigger | Worker job | Output |
|---|---|---|---|---|
| 1 | **Register upload** | UI `POST /api/sources/upload` | — | `data_sources` row + presigned PUT URL |
| 2 | **Upload file** | Browser PUT to storage, then `POST /api/sources/:id/complete` | `NORMALIZE_SOURCE` | features in `source_features` |
| 2a | Scan / raster without CRS | automatically | (preview PNG) | status `needs_georef` |
| 2b | **Geo-referencing** | officer places GCPs, `POST /api/georef/:id/apply` | `GEOREFERENCE` → re-queues `NORMALIZE_SOURCE` | GeoTIFF, CRS set |
| 2c | Scanned revenue PDF | officer clicks *Run OCR* | `DIGITIZE_SOURCE` → `SCHEMA_MAP` | OCR fields + confidences |
| 3 | **AI extraction** (rasters) | auto after ingest, or UI | `EXTRACT_FEATURES` | `ai_extracted` source + `extraction_runs` metrics |
| 4 | **Topology QA** (polygons) | auto after ingest / extraction, or UI | `FIX_TOPOLOGY` | `topology_issues` (+ fixes) |
| 5 | **Spatial matching** | auto after ingest / fixes, or UI | `HARMONIZE_WARD` | `matches` + confidence breakdown |
| 6 | **Conflict detection** | chained | `DETECT_CONFLICTS` | `conflicts` with severity + suggestion |
| 7 | **Golden-record assembly** | chained / UI | `ASSEMBLE_WARD` | `harmonized_parcels` with provenance |
| 8 | **Validation & sync** | chained / UI | `VALIDATE_WARD` | `validation_reports` + `sync_findings` |
| 9 | **Change detection** | UI (choose two epochs) | `DETECT_CHANGES` | `change_runs` + `change_detections` |
| 10 | **Publish** | always on | — | OGC API collections, GeoJSON / GeoPackage exports |

---

## 6. Algorithms and methods

### 6.1 ETL, CRS normalisation and single-geometry repair
- **Adapters** (`ingest/adapters.py`):
  - GeoTIFF via rasterio: the raster's extent is stored as its footprint.
  - GeoJSON and Shapefile via pyshp.
  - GPX via gpxpy.
  - CSV points with `lon, lat` columns.
  - The adapter is chosen by file extension first (so a scanned cadastral PNG is handled as a raster), then by source type.
- **CRS detection order:** CRS declared at upload → CRS embedded in the file → `detect_crs` (GeoTIFF / `.prj` / GeoJSON `crs` member, RFC 7946 default EPSG:4326).
- **Reprojection:** `pyproj.Transformer.from_crs(src, "EPSG:4326", always_xy=True)`, applied with `shapely.ops.transform`.
- **Geometry repair:** `shapely.validation.make_valid` fixes self-intersections, bow-ties and unclosed rings, with `buffer(0)` as a fallback. The feature is flagged `was_invalid`, which becomes a `self_intersection` topology issue.
- **Schema profiling:** field names and feature counts are stored in `metadata.fields`, ready for attribute mapping.

### 6.2 Geo-referencing engine (ground control points)
- **Input:** n pairs of image pixel (px, py) ↔ map coordinate (x, y).
- **Models:**
  - **Affine** (≥ 3 GCPs): x = a₀ + a₁·px + a₂·py (same for y).
  - **2nd-order polynomial** (≥ 6 GCPs): terms `[1, px, py, px², px·py, py²]`. This corrects the warping and shrinkage typical of old paper sheets.
- **Solver:** least squares via the normal equations (AᵀA)c = Aᵀb.
  - Pixel coordinates are first centred and scaled so the polynomial stays well conditioned.
  - Gaussian elimination with partial pivoting.
  - Collinear or duplicated points are rejected.
  - Implemented in TypeScript (`backend/src/georef/affine.ts`) for an **instant RMSE preview**, and in NumPy (`worker/src/georef/gcp.py`) for the final run.
- **Quality:**
  - The residual of each GCP is ‖f(px,py) − (x,y)‖, and RMSE = √(mean residual²).
  - Both are converted to metres (degrees × 111 320 × cos φ) and colour-coded: ≤ 1 m green, ≤ 3 m amber, otherwise red. This makes a bad point stand out immediately.
- **Output:**
  - **Affine:** a GeoTIFF with the affine geotransform written directly.
  - **Polynomial:** the image is warped through GDAL's GCP transformer (`rasterio.warp.reproject(gcps=…)`) onto a regular grid.
  - The source is then re-ingested automatically.

### 6.3 Coordinate transformation engine
- **Library:** proj4 (API), pyproj (worker).
- **Curated systems for Indian land records:**
  - WGS84 (EPSG:4326)
  - Web Mercator (3857)
  - UTM 43/44/45N (32643–32645)
  - **Kalianpur 1975 / UTM 44N & 45N** (24344 / 24345), with the Everest ellipsoid and a `towgs84` datum shift, for legacy Survey of India sheets
  - **India NSF LCC** (7755)
- **Endpoint:** `POST /api/crs/transform` converts up to 10 000 points per request.

### 6.4 GeoAI building-footprint extraction (`extract/footprints.py`)
All three detectors produce a binary building mask. After that the pipeline is shared.

| Method | When | How |
|---|---|---|
| **nDSM (height)** | DSM/DTM rasters (the default for `dsm_dtm`) | nDSM = DSM − DTM, and pixels with nDSM > `min_height_m` (default 2.5 m) are buildings. With a 2-band raster, band 1 is the DSM and band 2 the DTM. **With a DSM alone, the DTM is estimated with a grey-scale morphological opening** whose window (default 30 m) is larger than any building: a progressive-morphological ground filter. |
| **Deep-learning model** | when `FOOTPRINT_MODEL_PATH` points to an ONNX segmentation model (e.g. a U-Net trained on SpaceNet / Open Cities AI) | CPU inference with onnxruntime on 512 px tiles with 64 px overlap. Overlaps are averaged, logits pass through a sigmoid, and the result is thresholded at `prob_threshold` (0.5). |
| **Classical vision** | RGB imagery with no model | Excess-green index (2G − R − B > 20) masks vegetation, the darkest 10 % masks shadow, and Otsu thresholding on brightness finds the remaining roofs. |

**Shared post-processing:**
1. **Morphological open + close** with a kernel of ≈ 1.5 m removes noise and fills roof gaps.
2. **Connected components** (8-connectivity) are labelled with OpenCV. Components below `min_area_sqm` are dropped.
3. **Polygonise** with `rasterio.features.shapes`, keeping per-component statistics (mean and max height or probability).
4. **Douglas–Peucker simplification** (`simplify_m`, 0.5 m).
5. **Regularisation:** when a footprint covers ≥ 85 % of its minimum rotated rectangle (a near-rectangular roof), it is replaced by that rectangle. L-shaped footprints keep their shape.
6. **Reproject to WGS84.** Area is computed on the ellipsoid with `pyproj.Geod`.
7. **Per-footprint confidence:**
   - nDSM: 0.55 + 0.45·(1 − e^{−(h − h_min)/3}), capped at 0.98.
   - Model: mean probability.
   - Classical: 0.5.
8. Stored as an **`ai_extracted` data source**. Run metrics are recorded: count, mean confidence, mean height, total built-up area, area histogram and pixel size.
9. Chained into **topology QA** and **spatial matching**.

**Performance:** rasters are read with average resampling so the longest side is at most 4096 px, which keeps city-scale ORIs tractable on a CPU worker.

### 6.5 Automated topology correction (parcel fabric, `spatial/topology_fabric.py`)
All computation runs in PostGIS in the **local UTM zone** (`EPSG:326xx` from the data centroid), so tolerances are in metres.

| Issue | Detection | Proposed / automatic fix |
|---|---|---|
| **Overlap** | pairs where `ST_Intersects AND NOT ST_Touches` and intersection area > `overlapMinSqm` | `clip_from`: the smaller parcel loses the overlap (`ST_Difference`) |
| **Gap / sliver** | **morphological closing** of the union: `ST_Buffer(ST_Buffer(U, +w), −w) − U`, with w = `gapMaxWidthM`/2. This finds unclaimed strips narrower than 2w, including gaps that are open to the outside, which plain hole detection misses | `merge_into`: the strip is unioned into the neighbour sharing the **longest boundary** (`ST_Length(ST_Intersection(ST_Boundary(p), ST_Buffer(gap, 1 cm)))`) |
| Gap vs sliver | mean width ≈ 2·area / perimeter; < `sliverMaxWidthM` (0.5 m) means sliver | same as gap |
| **Duplicate vertex** | `ST_NPoints(g) − ST_NPoints(ST_RemoveRepeatedPoints(g, tol))` | `remove_repeated_points` |
| **Self-intersection** | flagged at ingestion | already repaired (`make_valid`), logged as `auto_fixed` |

- **Auto-fix:** with `autoFix` on, fixes are applied immediately. Otherwise the proposed geometry (`fixed_geom`) is stored and shown for review.
- **Accept / ignore / reopen:** the API applies the same SQL in a transaction. Every decision is audited, and each applied fix re-triggers matching.

### 6.6 AI/ML spatial matching (`match_ward.sql`, `match.py`, `scoring.py`)
1. **Candidate generation:**
   - features of **different source types** in the same ward
   - pruned by `ST_DWithin(a::geography, b::geography, 50 m)` using the GiST index, which reduces an O(n²) comparison to local neighbourhoods
   - raster extents are excluded
2. **Geometric similarity:**
   - polygon↔polygon: **Intersection-over-Union**, IoU = area(A∩B) / area(A∪B)
   - point↔feature: **geodesic distance to the centroid**, score = max(0, 1 − d/25 m)
   - a pair is kept when IoU ≥ 0.30 or d ≤ 25 m
   - **match score** = 100 × (IoU or distance score)
3. **Attribute similarity** (`attribute_score`):
   - B's field names are first renamed onto A's using the saved **schema mappings**
   - each shared field is compared:
     - numbers: 1 − |a−b| / max(|a|,|b|)
     - strings: normalised **Ratcliff/Obershelp** similarity (`difflib.SequenceMatcher`), case- and space-insensitive
   - the score is the mean, or a neutral 0.5 when there are no shared fields
4. **Source reliability prior:**

   | Source | Weight |
   |---|---|
   | GNSS/CORS | 1.0 |
   | Cadastral | 0.95 |
   | Ground truth | 0.9 |
   | Building footprints | 0.8 |
   | Municipal GIS | 0.8 |
   | Utility | 0.75 |
   | AI-extracted | 0.7 |
   | ORI | 0.7 |
   | DSM/DTM | 0.7 |
   | Revenue | 0.65 |
   | Drone imagery | 0.6 |

   A pair's reliability is the mean of its two sources' weights.
5. **Recency:** 1.0 if the older capture is < 1 year old, then halving every 5 years (0.5^((age − 1)/5)). Unknown dates score 0.8.
6. **Confidence** = 0.4·geometric + 0.3·attribute + 0.2·reliability + 0.1·recency. The breakdown is stored per match, so every score is **explainable** in the UI.
7. **Bands** (by match score): ≥ 85 **auto-accept**, ≥ 60 **review**, otherwise **conflict**.

> Why this counts as "AI/ML": it is a learned-prior, multi-feature similarity model (geometry + fuzzy attributes + source priors + temporal decay) with an LLM-driven schema alignment step. The weights and band thresholds are parameters that can be recalibrated from officers' accept/reject decisions, which are logged in `audit_logs`. The model is deliberately transparent rather than a black box, because land records need explainability.

### 6.7 Intelligent attribute mapping
- **LLM step:** field names plus up to 3 sample rows from both datasets go to an LLM (Groq, Llama-3.3-70B). It returns JSON `{field_a, field_b, confidence, rationale}` (e.g. `khata_no ↔ khata_number`, `area_sqm ↔ extent_sqyd` with a unit warning).
- **Deterministic fallback** when no LLM is configured: normalised-name match.
- **Automatic trigger:** OCR'd revenue documents are mapped automatically against the ward's newest structured source.
- **Where mappings are used:**
  - **matching**: attribute similarity
  - **conflict detection**: comparing like with like
  - **golden-record assembly**: fields renamed to canonical names

### 6.8 Spatial conflict-resolution framework (`conflicts.py`)
- **When a conflict is raised** (for each match):
  - shared fields that disagree → `attribute_mismatch`
  - IoU < 0.30 → `geometry_mismatch`
  - both → `both`
- **Severity:**
  - `critical` if score < 40 or geometry is bad
  - `high` if score < 70
  - `medium` if score < 90 or > 34 % of fields disagree
  - otherwise `low`
- **Suggested resolution:** "Reconcile ⟨fields⟩; trust the higher-reliability source."
- **Officer actions:** resolve, send to field review, or reject. Notes are audited.
- **Automatic resolution rule** in assembly (below): the most reliable source wins field by field. Unresolved conflicts block finalisation.

### 6.9 Golden-record assembly (`assemble.py`)
- **Clustering:** **union-find (disjoint-set)** over match edges forms connected components, i.e. one real-world parcel.
- **Geometry:** taken from the most reliable polygonal member.
- **Attributes:** merged field by field in reliability order, with schema-mapping renames. The **provenance** (which source each value came from) is stored.
- **Confidence:** mean member match score / 100.
- **Conflict count:** unresolved conflicts on the cluster.
- **Exports:** GeoJSON (synchronous) and GeoPackage (worker job, via Fiona).

### 6.10 Change detection
- **Multi-epoch structural change** (`change/epochs.py`): compares two footprint layers (e.g. a 2023 survey vs a 2025 AI extraction) in metric UTM.
  - Each current footprint is paired with the baseline footprint of highest overlap ratio, |A∩B| / min(|A|,|B|).
  - Classification:

    | Condition | Class |
    |---|---|
    | overlap ratio < 0.2 | `new_structure` |
    | height grew > 2.5 m | `vertical_extension` |
    | area change > +15 % | `extension` |
    | area change < −15 % | `reduction` |
    | unmatched baseline footprint | `demolished` |

  - Confidence combines the source confidence, the overlap and the magnitude of change.
  - Officers mark each change *confirmed* or *false positive*.
- **Satellite NDBI alerts** (existing): the NDBI difference between two dates plus area-expansion, OSM, vegetation-loss and register-match signals flag suspected new builds and change of use between surveys. Each alert has an LLM explanation and field verification.

### 6.11 Validation & synchronisation (`validate/report.py`)
- **Per-source checks.** Each check is scored 0–1 with partial credit. The score is a weighted mean × 100.

  | Check | Weight | Passes when |
  |---|---|---|
  | CRS declared | 1 | — |
  | Valid geometries | 2 | ≥ 99 % |
  | Attribute completeness | 2 | ≥ 90 % filled |
  | Unique IDs | 1 | no duplicate parcel/khata/bldg ids |
  | Ward coverage | 1 | ≥ 95 % inside |
  | Open topology issues | 2 | 0 |
  | Freshness | 1 | ≤ 5 years |

- **AI ↔ cadastre synchronisation.** The latest `ai_extracted` layer (or surveyed footprints) is compared with the latest cadastral layer:

  | Finding | Rule |
  |---|---|
  | **Unregistered structure** | < 20 % of the structure lies in any parcel |
  | **Encroachment** | > 15 % of a structure lies outside its main parcel |
  | **Vacant parcel** | no structure intersects the parcel |
  | **Attribute drift** | open attribute conflicts between departments |

- **Ward score** combines mean source quality, the registered-structure rate, encroachments and drift.

### 6.12 Finalisation readiness (`harmonized/readiness.ts`)
- A golden record is **ready** when it has no open conflicts, no open topology issues on its member features, and confidence ≥ 0.85.
- Otherwise it is classified as *blocked by conflict*, *blocked by topology* or *low confidence*, in the order an officer must fix them.
- The ward's **% ready** is the headline indicator for "accelerating cadastral finalisation".

### 6.13 OCR of scanned revenue records (`ocr/digitize.py`)
- **Pipeline:** PDF → page images (pdf2image) → OpenCV greyscale → non-local-means denoise → Otsu binarisation → Tesseract (`--psm 6`) with word confidences.
- **Field extraction:** regexes for khata no., owner name, survey no. and area/extent.
- **Storage:** each field is stored with its OCR confidence, then auto-mapped to the cadastral schema.

### 6.14 AI assistance
An LLM (Groq, Llama-3.3-70B) powers four features:
- the GeoAI assistant chat
- natural-language explanations of change alerts
- a daily brief
- ward alert text

All have deterministic fallbacks when no key is set.

### 6.15 Job orchestration, chaining and retries (`worker/src/main.py`, `queue_client.py`)
- **Queue:** a Redis list `queue:ingest`. Producers `LPUSH`, and each worker blocks on `BRPOP` (5 s timeout), so jobs run FIFO and any number of workers can share one queue.
- **Dispatch:** a handler table maps `jobType` to a function (12 job types: `NORMALIZE_SOURCE`, `DIGITIZE_SOURCE`, `SCHEMA_MAP`, `HARMONIZE_WARD`, `DETECT_CONFLICTS`, `ASSEMBLE_WARD`, `EXPORT_HARMONIZED`, `EXTRACT_FEATURES`, `FIX_TOPOLOGY`, `GEOREFERENCE`, `DETECT_CHANGES`, `VALIDATE_WARD`).
- **Tracking:** every job has a UUID that is also the `pipeline_jobs` primary key. The row is inserted by whoever enqueues it (API or worker, `ON CONFLICT DO NOTHING`), then moved `queued → running → done | failed`, with `attempts`, `result`, `error`, `started_at` and `finished_at`. Tracking errors are caught, so bookkeeping can never fail a job.
- **Retries:** on an exception the job is pushed back with `attempts + 1` and marked `queued` with the error. After **3 attempts** it goes to the dead-letter list `queue:ingest:dead` and is marked `failed`.
- **Chaining:** a handler enqueues its successor through `queue_client.enqueue`, which writes the `pipeline_jobs` row first. This gives the automatic chain in §5: ingest → extraction / topology → matching → conflicts → assembly → validation. The UI's Pipeline activity drawer shows chained jobs just like jobs started by an officer.

### 6.16 OGC API paging (`backend/src/ogc/paging.ts`)
- `limit` is clamped to 1–1000 (default 100) and `offset` to ≥ 0. Bad values fall back to the defaults instead of failing.
- `bbox=minLon,minLat,maxLon,maxLat` is validated (4 finite numbers, min ≤ max; otherwise HTTP 400) and becomes an `ST_Intersects(geom, ST_MakeEnvelope(…, 4326))` filter, which PostGIS answers from the GiST index.
- Every page returns `numberMatched` / `numberReturned` and `self`, `next` (when offset + limit < matched) and `prev` links. The other query parameters are preserved, so GDAL / QGIS can follow the links to fetch a whole collection.

---

## 7. Data model

All geometries are `geometry(…, 4326)` with GiST indexes. The core tables are:

| Table | Purpose |
|---|---|
| `wards` | admin units + bbox/boundary |
| `data_sources` | every dataset: type (10 NAKSHA types + `ai_extracted`), CRS, capture date, status (`processing / ready / pending_ocr / needs_georef / failed`), metadata (fields, OCR, georef, preview) |
| `source_features` | normalised features of every source (+ `was_invalid`) |
| `ocr_results` | OCR fields with confidence |
| `schema_mappings` | field correspondences (LLM / rules, approval flag) |
| `matches` | cross-source pairs: IoU, distance, score, confidence breakdown |
| `conflicts` | type, severity, detail, suggestion, status, notes |
| `harmonized_parcels`, `harmonized_exports` | golden records with provenance; export files |
| `pipeline_jobs` *(0012)* | every queued job with status, attempts, result, error, timings |
| `extraction_runs` *(0013)* | GeoAI runs: method requested/used, params, metrics, result source |
| `topology_issues` *(0014)* | overlap/gap/sliver/duplicate/self-intersection with fix + fixed geometry |
| `change_runs`, `change_detections` *(0015)* | epoch comparisons and classified changes |
| `validation_reports`, `sync_findings` *(0016)* | quality scorecards and AI↔cadastre findings |
| `properties`, `verification_status` | satellite (NDBI) change alerts + field verification |
| `profiles`, `audit_logs` | roles / ward scope, and the governance trail |

Migrations live in `database/migrations/0001…0016`. They are applied idempotently by `database/migrate.sh`, which tracks them in `schema_migrations`. Seeds include a keyless demo; `demo_pipeline.sql` adds a ward-4 cadastral fabric with deliberate overlaps, gaps and slivers, plus 2023 vs AI-2025 footprint epochs.

---

## 8. API reference

Base URL `/api`. All bodies are JSON. Role gates are shown in brackets.

**Ingest**
- `POST /sources/upload` [admin, analyst] → `{sourceId, uploadUrl, contentType}`, then PUT the file.
- `POST /sources/:id/complete` → queues ETL.
- `GET /sources`, `GET /sources/:id` (includes `download_url`, `preview_url`), `GET /sources/:id/features`, `POST /sources/:id/digitize`.

**Geo-referencing & CRS**
- `POST /georef/:id/preview` → residuals and RMSE in metres.
- `POST /georef/:id/apply` → job.
- `GET /crs`, `POST /crs/transform {from, to, points}`.

**Processing**
- `POST /extraction/run {sourceId, method, params}`, `GET /extraction/runs`, `GET /extraction/runs/:id`.
- `POST /topology/run {sourceId, toleranceM, gapMaxWidthM, sliverMaxWidthM, autoFix}`, `GET /topology/issues`.
- `POST /topology/issues/:id/resolve {action: accept_fix | ignore | reopen}`, `POST /topology/sources/:id/accept-all`.

**Harmonization**
- `POST /harmonization/run`, `GET /harmonization/matches`, `GET /harmonization/matches/:id`.
- `POST|GET /harmonization/schema-map`.
- `GET /conflicts`, `POST /conflicts/:id/resolve`.
- `POST /harmonized/assemble`, `GET /harmonized`, `GET /harmonized/:id`, `GET /harmonized/readiness`, `GET /harmonized/export?format=geojson|gpkg`, `GET /harmonized/exports`.

**Validate**
- `POST /validation/run`, `GET /validation/reports`, `GET /validation/findings` (GeoJSON), `GET /validation/history`.
- `POST /changes/run`, `GET /changes/runs`, `GET /changes`, `POST /changes/:id/verify`.
- Satellite alerts: `GET /wards/:id/unassessed`, `POST /properties/:id/verify`, `GET /properties/:id/explain`, `GET /stats`.

**Publish (OGC API – Features, Part 1 Core + GeoJSON)**
- `GET /ogc`, `/ogc/conformance`, `/ogc/collections`, `/ogc/collections/:id`, `/ogc/collections/:id/items?bbox&limit&offset&wardId`.
- Collections: `harmonized-parcels`, `change-detections`, `topology-issues`, `sync-findings`, and `source-{uuid}` for every vector source.
- Responses include `numberMatched`, `numberReturned` and `next`/`prev` links.
- Usable directly in QGIS, ArcGIS or `ogr2ogr "OAPIF:<url>"`.

**Operations**
- `GET /jobs`, `GET /audit`, `GET /health` (db / queue / storage), `POST /admin/refresh`, `POST /admin/db-config` (thresholds), `POST /chat`.

---

## 9. User interface & UX

- **Layout:** a sidebar shell grouped by lifecycle (**Ingest → Process → Harmonize → Validate → Publish → Admin**).
- **Top bar** (shared by every page):
  - a single **ward picker**
  - a live **Pipeline activity** drawer, which polls jobs every 4 s while work is running
  - system health
  - the demo/live badge
- **Map:** MapLibre GL with free OSM streets and Esri World Imagery satellite tiles, so no API key is needed. A declarative multi-layer `GeoMap` component handles polygons, lines and points, per-feature colours, legends, map/feature click and fit-to-data.

| Page | What the officer does |
|---|---|
| **Command centre** | Sees outcome KPIs (manual effort avoided, accuracy score, consistency, % ready for finalisation), live state of all 11 pipeline stages, coverage of the 10 source types, readiness bar, recent jobs; runs harmonization |
| **Data sources** | Uploads any of the 10 types (CRS, capture date, ward); sees status, schema, OCR fields + confidences, map preview; "Georeference →" for scans |
| **Geo-referencing & CRS** | Clicks a point on the scan then the same point on the map; sees per-point residuals and RMSE live; chooses affine / polynomial; applies. Converts coordinates between Indian CRSs |
| **AI feature extraction** | Picks a raster and method (auto / nDSM / model / classical) and thresholds; sees footprints coloured by confidence, metrics and size histogram, run history |
| **Topology QA** | Runs checks with tolerances / auto-fix; sees issues by type on the map with the proposed fix outline; accepts, ignores or accepts all |
| **Integration map** | Toggles every source layer, AI layer, golden records, open topology issues and sync findings; highlights repaired geometry |
| **Spatial matching** | Filters matches by pair/band/score; compares A vs B on a map and field by field; sees the four-term confidence breakdown |
| **Attribute mapping** | Selects two datasets, gets AI-suggested field mappings with rationale, saves them for assembly |
| **Conflicts** | Severity-ranked queue; map comparison; disagreeing fields highlighted; resolve / field review / reject with notes |
| **Validation & sync** | Ward score ring and checks; per-source scorecards; findings map (unregistered, encroachment, vacant, drift) |
| **Change detection** | Chooses baseline and current epochs; sees new / demolished / extended / raised structures with before-outlines; confirms or rejects; NDBI alerts tab |
| **Golden records** | Finalisation readiness panel with drill-through; map by confidence; attribute provenance; GeoJSON / GeoPackage export |
| **Data exchange (OGC)** | Collections with counts, copyable URLs, live preview, QGIS / GDAL instructions |
| **Activity log** | All pipeline jobs (duration, result, error) and the audit trail |
| **Settings & health** | Service health, re-harmonize all wards, detection thresholds |

**UX principles:**
- Every automated number is explainable: breakdowns, residuals, provenance and rules are shown next to it.
- Destructive or legal-impact actions are always a human decision.
- Background work is visible.
- Layouts are responsive (a mobile drawer from 390 px upwards).
- ARIA roles and labels are used throughout.

---

## 10. Tech stack and why we chose it

| Layer | Choice | Why |
|---|---|---|
| Spatial database | **PostgreSQL 16 + PostGIS 3.4** | The standard open spatial DB. It has GiST indexes, `geography` for metric accuracy, and every topology primitive we need (`ST_Intersection`, `ST_Buffer`, `ST_Union`, `ST_MakeValid`, `ST_RemoveRepeatedPoints`), with no licence cost, and works as managed Postgres (Supabase / RDS) |
| Geo-processing worker | **Python 3.12**: rasterio/GDAL, Shapely 2, pyproj, Fiona, OpenCV, NumPy, onnxruntime, Tesseract | Python is the GIS + computer-vision ecosystem. GDAL reads virtually every raster/vector format. ONNX runs any trained segmentation model on CPU without a GPU dependency |
| Job queue | **Redis** list queue + `pipeline_jobs` table | Simple and fast, with no extra infrastructure. Retries (3×) and a dead-letter queue. The table gives progress tracking and history. A worker crash mid-job can still lose that job; see §17 |
| API | **NestJS (TypeScript)** | Structured modules, DI and validation pipes (class-validator) keep a large API maintainable. The same language as the frontend |
| CRS maths in the API | **proj4js** + own least-squares solver | Instant previews (GCP RMSE, coordinate conversion) without a round-trip to the worker |
| Object storage | **S3 API**: Cloudflare R2 (cloud) / **MinIO** (local, `bitnamilegacy/minio` image) | Presigned URLs let browsers upload large rasters directly. R2 has zero egress fees. MinIO makes local development keyless |
| Auth | **Supabase Auth (JWT)** + role guard (admin / official / analyst); dev bypass | Managed auth with no password handling in our code; roles and ward scope in `profiles` |
| AI / LLM | **Groq (Llama-3.3-70B)**, with deterministic fallbacks | Fast, low-cost inference for schema mapping and explanations. The system still works fully offline without it |
| Frontend | **React 18 + Vite**, **Redux Toolkit**, **React Router**, **Tailwind CSS v4**, **Framer Motion** | A fast dev loop and a static SPA (host anywhere). Predictable state for many async pipelines. A utility-first design system with consistent tokens |
| Web map | **MapLibre GL** with OSM + Esri tiles | Open-source WebGL vector map (fork of Mapbox GL), smooth with thousands of features, no API key or vendor lock-in |
| Interoperability | **OGC API – Features**, GeoJSON (RFC 7946), **GeoPackage** | Open OGC standards consumed natively by QGIS, ArcGIS and GDAL, which are required for inter-departmental exchange |
| Mock API | **MSW** (Mock Service Worker) | The whole UI runs offline with realistic data, for demos, UI development and tests |
| Testing | **Vitest + Testing Library** (UI), **Jest** (API), **pytest** (worker), MapLibre style-spec validation | Fast unit and integration tests for each layer |
| Containers / CI | **Docker Compose**, GitHub Actions | One-command local stack; CI builds and tests all three services |

---

## 11. Repository structure

```
backend/            NestJS API
  src/{sources,harmonization,conflicts,harmonized,extraction,topology,georef,crs,changes,validation,ogc,jobs,audit,…}
  src/georef/affine.ts, src/crs/crs.ts, src/ogc/paging.ts, src/harmonized/readiness.ts  (+ *.spec.ts)
worker/             Python geo-processing worker
  src/main.py                job dispatcher + pipeline_jobs tracking
  src/ingest/adapters.py     ETL + chaining
  src/georef/gcp.py          geo-referencing
  src/extract/footprints.py  GeoAI extraction
  src/spatial/…              CRS, geometry repair, parcel-fabric topology
  src/harmonize/…            matching, scoring, conflicts, schema map, assembly
  src/change/epochs.py       change detection
  src/validate/report.py     validation & sync
  src/ocr/digitize.py        OCR
  tests/                     pytest suite
database/           migrations 0001–0016, migrate.sh, seeds (incl. demo_pipeline.sql)
frontend/           React + Vite SPA
  src/views/*Page.jsx, src/components/{GeoMap,AppShell,PipelineActivity,…}
  src/Redux/slices/*, src/mocks/* (MSW demo backend), src/utils/{format,affine}.js
docker-compose.yml  db · redis · minio · migrate · api · worker
```

---

## 12. Development setup

**Prerequisites:** Docker Desktop and Node 20. Python 3.12 is only needed to run worker tests outside Docker.

```bash
cp .env.example .env              # works as-is: local Postgres/PostGIS, Redis, MinIO, dev auth bypass
docker compose up --build         # db, redis, minio (+bucket), migrations + seeds, api :3000, worker
cd frontend && npm install && npm run dev      # http://localhost:3001
```

- **A filled-in `.env` wins over the local containers.** Compose only falls back to the bundled Postgres, Redis and MinIO when `DATABASE_URL`, `REDIS_URL` and `R2_*` are blank. With a `.env` prepared for Supabase / R2, blank those variables (in `.env` or in the shell) for a fully local run; otherwise the stack talks to the cloud database, or fails storage health checks with placeholder keys.
- **Frontend only, no backend:**
  ```bash
  cd frontend && VITE_MOCK=true npm run dev
  ```
- **Optional keys** in `.env`:
  - `GROQ_API_KEY`: live LLM
  - `SUPABASE_*` + `AUTH_DEV_BYPASS=false`: real login
  - `R2_*` / `R2_PUBLIC_ENDPOINT`: Cloudflare R2 instead of MinIO
  - `FOOTPRINT_MODEL_PATH`: ONNX building model (mount it into the worker)
- **Tests:**
  ```bash
  cd frontend && npm test
  cd backend  && npm run build && npm test
  cd worker   && pip install -r requirements.txt pytest && pytest -q
  ```

### 12.1 How the platform was developed
Development followed the pipeline order in §5, one PS requirement at a time. Each step was built in four layers:
1. **Schema first.** A numbered, idempotent migration (`0012_pipeline_jobs` … `0016_validation`) defines the tables the feature writes, with CHECK constraints on every status and type column and GiST indexes on every geometry.
2. **Worker algorithm.** The maths is kept in **pure functions** (e.g. `classify_changes`, `classify_gap`, `weighted_score`, the GCP solver, nDSM masking), unit-tested with pytest on synthetic geometries and rasters, with no database needed. A thin handler around them does the PostGIS reads and writes.
3. **API module.** A NestJS module per capability (`extraction`, `topology`, `georef`, `crs`, `changes`, `validation`, `ogc`, `jobs`, `audit`) validates input, queues the job, records it in `pipeline_jobs`, and serves results. Instant maths (GCP RMSE preview, CRS transform, readiness, paging) is duplicated in TypeScript and covered by Jest.
4. **UI page.** Built mock-first against **MSW** handlers (`frontend/src/mocks/pipelineHandlers.js`) with realistic data. The whole workbench can therefore be designed, demoed and tested without a backend, then switched to the live API with `VITE_MOCK=false`.

A keyless **demo seed** (`demo_pipeline.sql`) contains deliberate topology errors and two footprint epochs, so every stage produces visible results on a fresh database.

### 12.2 Configuration reference (`.env`)

| Variable | Used by | Purpose / default |
|---|---|---|
| `DATABASE_URL`, `REDIS_URL` | api, worker | Blank → bundled Postgres/PostGIS and Redis containers |
| `AUTH_DEV_BYPASS` | api | `true` for local dev (role picked on the login screen); **must be `false` in production** |
| `PROFILES_SOURCE` | api | Where roles and ward scope live: bundled Postgres or `supabase` |
| `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` | api | Real authentication |
| `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` | frontend | Browser login |
| `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET_NAME` | api, worker | Cloudflare R2 object storage |
| `R2_ENDPOINT`, `R2_PUBLIC_ENDPOINT` | api, worker | Any S3-compatible store (MinIO); the public endpoint is used in presigned URLs |
| `GROQ_API_KEY` | api, worker | LLM for attribute mapping and explanations; blank → deterministic fallbacks |
| `FOOTPRINT_MODEL_PATH` | worker | ONNX building-segmentation model; blank → nDSM / classical vision |
| `VITE_API_URL`, `API_URL`, `FRONTEND_ORIGIN` | frontend, api | API base URL and CORS origin |
| `VITE_MOCK` | frontend | `true` → run the UI entirely on MSW mock data |
| `BREVO_API_KEY`, `BREVO_SENDER_*`, `RESEND_API_KEY` | api | Optional alert e-mails |
| `DEPLOY_HOST`, `DEPLOY_USER`, `DEPLOY_SSH_KEY` | CI | SSH deployment of the API and worker images (GitHub secrets) |

---

## 13. Testing & verification status

Last full run: **2026-09-25**.

| Suite | Result | What it covers |
|---|---|---|
| Frontend build | **`vite build` OK** | Production bundle with every page lazy-loaded as its own chunk. The map chunk (MapLibre GL) is ≈ 1 MB, 281 kB gzipped |
| Frontend (Vitest) | **28 / 28 passing** | Every page against the MSW API (upload, OCR, matching, attribute mapping, conflict resolution, golden records, geo-referencing + CRS, extraction run, topology accept, validation findings, change confirm, NDBI verify, OGC collections, activity/audit); mappers; MapLibre style-spec validation |
| Backend (Jest) | **12 / 12 passing**; `nest build` OK | GCP solver (exact fit, poly2 vs affine, outlier residual, collinearity), CRS transforms (UTM round-trip, Kalianpur datum shift), OGC paging, finalisation readiness |
| Worker (pytest) | **22 / 22 passing**; all modules compile and import | nDSM mask, morphological DTM estimation, polygonisation with heights, regularisation, confidence; change classification; GCP solve and residuals; attribute similarity, recency, confidence weights; gap-vs-sliver, UTM zone; completeness, duplicates, weighted score; OCR field extraction |
| **Full stack, end to end** | **35 / 35 checks passing** | See below |
| UI walkthrough | Headless Chrome screenshots of every page (desktop + mobile), mock mode | Layouts, maps, legends, no console exceptions |

Notes on the worker unit run: it used Python 3.14 with current wheels of the same libraries, because the pinned versions (e.g. numpy 2.1.1, rasterio 1.3.11) ship no 3.14 wheels. The Docker image and CI use Python 3.12 with the exact pins.

### 13.1 End-to-end run on the Docker stack
Run on `docker compose up --build` with a fresh database (Docker Desktop 29.8, images on D:). Every step went through the REST API as the UI does it, then waited for the chained jobs to finish.

| Step | Result |
|---|---|
| Health | db, Redis and object storage ok |
| Migrations 0001–0016 + seeds + pipeline demo layers | applied cleanly on PostGIS 16-3.4 |
| Topology QA on the demo cadastral fabric | 3 issues (overlap, sliver) with proposed geometries; accepting the overlap fix applied it in a transaction |
| Harmonization chain (match → conflicts → assemble → validate) | 10 matches, 9 golden records, readiness 22 % (7 blocked by conflicts) |
| Validation & sync | ward report (score 67.8) and findings: unregistered structure, encroachment, attribute drift |
| Change detection 2023 survey vs AI 2025 | 6 changes: new structure, demolished, extension, vertical extension |
| DSM/DTM GeoTIFF upload (presigned PUT) → ETL → GeoAI extraction | nDSM method, exactly the 3 synthetic buildings found |
| Scanned PNG sheet → `needs_georef` → 4 GCPs → affine | RMSE 0 m, re-ingested as ready |
| Scanned revenue PDF → OCR → automatic attribute mapping | khata 4521/B, survey 210/1, extent 750 sq m, owner "Venkatesh Rao" |
| GeoPackage export | 9 parcels; the file downloads and is a valid SQLite/GPKG |
| OGC API – Features | 11 collections; items page with `numberMatched` and `next` link |
| Pipeline jobs | all 12 job types ran; **0 failed, 0 retried** |

**Defects found by this run and fixed** (none of them was visible to unit tests or the mock UI):
1. **Topology job crashed on every gap or sliver.** PostGIS returned `uuid[]`, which psycopg2 cannot decode, so the ids arrived as one string and were inserted character by character (`invalid input syntax for type uuid: "{"`). The query now returns `text[]` (`spatial/topology_fabric.py`).
2. **GeoPackage export always failed** (`… .gpkg already exists`). `mkstemp` created the file that Fiona then refused to overwrite, and leaked a file descriptor. It now writes into a fresh temporary directory (`harmonize/assemble.py`).
3. **Demo layers could not be processed from the UI.** The fixed demo ids (`33333333-3333-3333-3333-…`) are not valid UUIDs, so the API's `@IsUUID()` validation rejected topology and change-detection runs on them with HTTP 400. They now use valid ids (`33333333-3333-4333-8333-…`); `migrate.sh` recognises both forms so an already-seeded database is not seeded twice.
4. **OCR owner name ran into the next field** ("Venkatesh Rao Survey No"), because a page's words are joined into one line. The pattern now stops at the next label; field extraction moved into `extract_fields()` with unit tests.
5. **`docker compose up` could not start.** MinIO no longer publishes `minio/minio` or `minio/mc` on Docker Hub or quay.io. Local storage now uses `bitnamilegacy/minio` (the same server), which also creates the bucket itself, so the `minio-init` container was removed.
6. **`migrate.sh` failed on Windows checkouts saved with CRLF** (`set: Illegal option -`). It was converted back to LF. Keep shell scripts LF; `.gitattributes` already enforces this on commit.
7. The AI-footprint demo source declared 7 features but inserts 8.

CI (`test.yml`) also runs the frontend tests and production build now, and the worker job fails when pytest fails. Previously it tolerated "no tests collected".

**Not covered by the end-to-end run:** real Supabase login (it ran with `AUTH_DEV_BYPASS=true`), Cloudflare R2 (MinIO was used), the live Groq LLM, an ONNX model, and the UI clicking through against the live API. The UI was tested against the mock API, which follows the same response shapes.

---

## 14. Deployment

### 14.1 Topology (recommended, low-cost)

| Component | Service | Notes |
|---|---|---|
| Frontend | **Vercel** (static SPA) | `frontend/vercel.json` provides the Vite preset + SPA rewrite. Env: `VITE_API_URL`, `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` |
| API + worker | One **Docker host** (any VM: AWS EC2 / Azure / NIC MeghRaj), `docker compose up -d api worker` | ≥ 2 vCPU / 4 GB RAM; scale workers horizontally (`--scale worker=N`) since they only share the queue |
| Database | **Supabase Postgres** (PostGIS enabled) or AWS RDS for PostgreSQL + PostGIS | Run `database/migrate.sh` with `DATABASE_URL` |
| Queue | **Upstash Redis** or a Redis container | `REDIS_URL` |
| Object storage | **Cloudflare R2** (bucket + API token; CORS allowing PUT/GET from the frontend origin) | `R2_*`, `R2_BUCKET_NAME` |
| Auth | **Supabase Auth** | `AUTH_DEV_BYPASS=false`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`; the first user becomes admin |
| LLM (optional) | Groq | `GROQ_API_KEY` |

A government on-prem deployment works the same way with Postgres/PostGIS, Redis and MinIO on the state data centre. No cloud-specific services are required.

### 14.2 CI/CD
GitHub Actions workflows:
- `test.yml` (every push and PR):
  - backend: build and Jest
  - frontend: `npm ci`, Vitest and production build
  - worker: pytest on Python 3.12 with GDAL, Tesseract and Poppler installed
- `deploy-frontend.yml`: Vercel
- `deploy-backend.yml` and `deploy-worker.yml`: build images and deploy over SSH to the Docker host

Secrets are kept in GitHub / Vercel, never in the repository. `.env*` files are git-ignored.

### 14.3 Go-live checklist
1. Apply migrations 0001–0016; seed wards (ward boundaries from the ULB).
2. Set `AUTH_DEV_BYPASS=false`, configure Supabase and assign roles (admin / official / analyst) with ward scope.
3. Configure R2 CORS for the frontend origin; set `R2_PUBLIC_ENDPOINT` only when using MinIO.
4. Smoke test:
   - upload a cadastral GeoJSON → Topology QA shows issues
   - upload a DSM GeoTIFF → Extraction produces an `ai_extracted` layer → matches and validation update
   - upload a PNG scan → geo-reference with 4+ GCPs → becomes ready
   - `GET /api/ogc/collections/harmonized-parcels/items` opens in QGIS
5. Optional: mount an ONNX building model and set `FOOTPRINT_MODEL_PATH`.

---

## 15. Security, governance & data protection
- **Auth and permissions:**
  - JWT auth (Supabase) with role-based guards on every write endpoint.
  - Ward scope per user.
  - The dev bypass must never be enabled in production.
- **Uploads:**
  - Presigned URLs expire after 5 minutes (PUT) and 1 hour (GET).
  - Content types are fixed server-side.
  - Uploads never pass through the API.
- **Input handling:**
  - Every body is validated (class-validator whitelist).
  - SQL is always parameterised; OGC collection ids are resolved against a fixed allow-list or a UUID lookup.
- **Governance:**
  - `audit_logs` records who did what (conflict decisions, topology fixes, geo-referencing, verifications, runs).
  - `pipeline_jobs` records every automated change, giving a traceable land-governance trail.
- **Personal data** (owner names in revenue records): access requires authentication; storage and processing stay within the deployment's region/data centre.

---

## 16. Expected outcomes and how we measure them

| PS outcome | How the platform delivers it | Metric shown in the Command centre |
|---|---|---|
| Reduce manual GIS integration effort | Automatic ETL, CRS, repair, matching, topology fixes, assembly | **Manual effort avoided** = auto-accepted matches + auto-applied topology fixes |
| Improve accuracy & consistency | Validation rules, AI↔cadastre sync, conflict framework | **Record accuracy** (ward validation score) and **Consistency** (% conflicts resolved) |
| Seamless inter-departmental exchange | OGC API – Features, GeoJSON / GeoPackage | Published collections |
| Accelerate cadastral finalisation | Readiness classification with drill-down to blockers | **% ready for finalisation** |
| Interoperability | Open standards, CRS engine incl. legacy Indian datums | — |
| Standardised digital land governance | Role-based workflow, audit trail, job history | Activity log |

---

## 17. Known limitations & future work
- **No pretrained building model is bundled.** The deep-learning path activates when an ONNX model is supplied (e.g. trained on SpaceNet / Open Cities AI / NAKSHA drone data). Without one, nDSM (elevation) or classical vision is used, and the UI shows which method ran. **Next:** train and fine-tune a U-Net / SAM-based model on NAKSHA orthophotos and ship it as the default.
- **Change detection** compares vector epochs, plus satellite NDBI alerts (currently seeded demo data). **Next:** raster DSM differencing and an automatic Sentinel-2 NDBI pipeline.
- **Confidence weights and band thresholds** are expert-set. **Next:** learn them (logistic regression / gradient boosting) from officers' accept/reject decisions in the audit log.
- **Topology:** fixes cover overlaps, gaps, slivers and duplicate vertices within one layer. **Next:** cross-layer snapping (edge-matching to GNSS/CORS control) and rule-based parcel-fabric adjustment.
- **Geo-referencing:** supports affine and 2nd-order polynomial. **Next:** thin-plate spline for badly deformed sheets, and automatic GCP suggestion by feature matching (ORB/SIFT against ORI).
- **Job queue durability:** `BRPOP` removes a job before it runs, so a worker killed mid-job loses that job, and the `pipeline_jobs` row stays `running`. Retries are immediate, with no back-off. **Next:** a reliable queue (`BLMOVE` into a per-worker processing list plus a reaper for stale `running` rows), or Redis Streams with consumer groups, and exponential back-off.
- **Scale:** matching is per ward with spatial-index pruning; very large wards may need tiling or partitioned tables. The worker scales horizontally.
- **Verification:** the Docker stack passed an end-to-end run (§13.1). **Next:** repeat it with real Supabase auth, R2 and the Groq key, click through the UI against the live API, and add the smoke test to CI as a job that runs `docker compose`.

---

## 18. Glossary

| Term | Meaning |
|---|---|
| **ORI** | Orthorectified Imagery: geometrically corrected aerial/drone image with uniform scale |
| **DSM / DTM / nDSM** | Digital Surface Model (top of everything) / Digital Terrain Model (bare ground) / normalised DSM = DSM − DTM (object heights) |
| **GCP** | Ground Control Point: a pixel ↔ map coordinate pair used to geo-reference a scan |
| **RMSE** | Root-mean-square error of GCP residuals (fit quality, metres) |
| **IoU** | Intersection-over-Union: overlap measure between two polygons (0–1) |
| **CORS** | Continuously Operating Reference Stations (high-accuracy GNSS reference) |
| **Golden record** | The single harmonized version of a parcel assembled from all matching sources, with provenance |
| **Sliver / gap / overlap** | Thin unclaimed strip / unclaimed area / doubly-claimed area between neighbouring parcels |
| **NDBI** | Normalised Difference Built-up Index from multispectral satellite imagery |
| **OGC API – Features** | Open Geospatial Consortium standard REST API for vector data |
| **Khata / Survey number** | Revenue account number / cadastral survey identifier of a land parcel |
