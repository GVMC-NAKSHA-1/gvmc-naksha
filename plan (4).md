# HORCRUX — Alignment & Delivery Plan for SIH PS 26013
**Automated Integration and Intelligent Harmonization of Multi-Source Geospatial Data for Urban Land Record Management**

> **Budget note:** this plan assumes a student building on free tiers, not a funded team. AWS is kept only where it's already deployed and genuinely free at this scale (Lambda, S3, the RDS MySQL free-tier instance); everything added on top — the spatial database, the DL/matching pipeline, and the LLM explanations — is chosen from free/open-source options first. See **§10 — Free & Low-Cost Resource Substitutions** for the full list and exactly what to swap.

---

## 0. Purpose of this document

This plan takes the system **as it exists today** in `Team-Horcurx/backend`, `frontend`, `pipeline`, and `gvmc-backend` and defines the shortest technically-honest path to a prototype that satisfies **every bullet** of PS 26013 — without silently dropping what's already built (which is real, working infrastructure) and without promising anything the team cannot ship.

Everything below is written to be buildable on the current stack (AWS Lambda + API Gateway + RDS MySQL + S3 + Bedrock + React/Leaflet), not a rewrite.

---

## 1. What actually exists right now (ground truth)

| Component | State | Notes |
|---|---|---|
| `backend` | Working | Single Lambda, regex router, RDS MySQL, S3 presigned URLs, Bedrock (Llama via cross-region inference profile, fallback to templated text) |
| `frontend` | Working | React, built against a mocked API (`frontend/src/mocks/data/*.js`), Amplify-deployed |
| Domains implemented | `wards`, `properties`, `stats`, `alerts`, `chat`, `admin` | Ward polygons in S3 as GeoJSON; per-ward "unassessed" property lists; CSV upload; verify workflow (`accept/reject/notes`); Bedrock-generated natural-language explanations and ward briefs |
| `pipeline` repo | Scaffolded, not wired to backend | Contains `bedrock_client.py`, schema stubs, sample chat test — this is the natural home for the DL/GIS processing engine described below |
| Data model | Single-purpose | `wards`, `properties`, `alerts` tables — **one implicit source** (drone/satellite change detection against a property list), no concept of multiple independent datasets per parcel |
| Auth | None (public demo) | Fine for a hackathon demo; flagged as a production gap, not fixed here |
| Spatial engine | None yet | No PostGIS, no Shapely-based topology checks, no matching/conflict/confidence logic — GeoJSON is stored as a static blob per ward, not queried spatially |

**Honest framing:** what exists today is a **single-source change-detection and verification tool** (imagery vs. a property register, for one municipality/GVMC). PS 26013 asks for a **multi-source harmonization engine** across up to 10 dataset types with AI/ML matching, topology correction, attribute mapping, georeferencing, conflict resolution, and confidence scoring. The gap is real but bridgeable: the verify/alert/stats/chat UX pattern already built is *exactly* the right shape for the human-in-the-loop layer the PS also asks for — it just needs to sit on top of a proper multi-source spatial data model instead of one table.

---

## 2. Requirement-by-requirement alignment map

This table is the "100% alignment" contract. Every PS bullet has an explicit owner module below.

| PS 26013 requirement | Delivered by | New / Reused |
|---|---|---|
| Integrate drone imagery | Ingestion Layer, source type `drone` | New (generalizes `properties` CSV upload path) |
| Integrate ORI | Ingestion Layer, source type `ori` | New |
| Integrate DSM/DTM | Ingestion Layer, source type `dsm_dtm` (raster) | New |
| Integrate existing cadastral maps | Ingestion Layer, source type `cadastral` | New |
| Integrate revenue records | Ingestion Layer, source type `revenue` (tabular) | Reuses CSV-upload path from `admin` |
| Integrate municipal GIS layers | Ingestion Layer, source type `municipal` | **Reused** — this is what `wards`/`properties` already model |
| Integrate utility network data | Ingestion Layer, source type `utility` | New |
| Integrate Ground Truthing (GT) datasets | Ingestion Layer, source type `ground_truth` | New |
| Integrate GNSS/CORS survey data | Ingestion Layer, source type `gnss` (point data) | New |
| Integrate building footprint datasets | Ingestion Layer, source type `building_footprint` | New |
| AI/ML-based spatial matching | Reconciliation Engine (IoU + boundary + attribute similarity → matcher) | New (`pipeline` repo) |
| Automated topology correction | Topology Engine (Shapely/PostGIS: overlap, gap, self-intersection, containment) | New |
| Intelligent attribute mapping | Schema Harmonizer (canonical parcel schema + field-name mapping table) | New |
| Geo-referencing & coordinate transformation | Preprocessing stage (`pyproj`/`GDAL` CRS normalization) | New |
| Change detection | Change Detection module | **Reused** — this is the core of what `backend`/`pipeline` already do (ward-level unassessed property detection); generalized to any two dataset snapshots, not just imagery-vs-register |
| Spatial conflict resolution framework | Conflict Detection + Review Dashboard | **Reused** — `alerts` + `properties.verify` endpoints are the existing skeleton of this; extended to carry conflict type/severity instead of just alert text |
| Confidence scoring | Confidence Engine (weighted score → auto-accept / review / reject) | New, but slots directly into existing `verify` action and `stats` aggregation |
| Reduce manual GIS effort | End-to-end automated pipeline + single review queue | Result of all of the above |
| Improve accuracy/consistency | Confidence scoring + audit log | New (`audit_log` table) |
| Inter-departmental data exchange | REST + OGC-style export endpoints | Extends existing REST API |
| Accelerate cadastral finalization | Auto-accept path for high-confidence matches | New |
| Improve interoperability | Canonical schema + GeoJSON/CSV export | New |
| Standardized digital land governance | Master Parcel table with source lineage + ULPIN-style reference field | New |

Nothing in the PS is left unmapped; nothing above requires infrastructure outside what the team can run (Python geospatial stack + MySQL/PostGIS + S3 + Lambda + React/Leaflet, already proven working in `backend`).

---

## 3. Target architecture (built on the existing stack)

```
                         MULTI-SOURCE UPLOAD
   drone | ORI | DSM/DTM | cadastral | revenue | municipal
   utility | ground-truth | GNSS | building footprints
                              │
                              ▼
                    ┌───────────────────┐
                    │  INGESTION LAYER  │   (extends admin/upload-csv +
                    │  (backend Lambda) │    new /datasets/upload for
                    └─────────┬─────────┘    raster/vector types)
                              ▼
                    ┌───────────────────┐
                    │  PREPROCESSING    │   CRS normalization (pyproj),
                    │  (pipeline repo,  │   schema harmonization,
                    │  async worker)    │   raster/vector validation
                    └─────────┬─────────┘
                              ▼
              ┌───────────────┴───────────────┐
              ▼                               ▼
   ┌─────────────────────┐        ┌─────────────────────┐
   │  FEATURE EXTRACTION  │        │  GIS OPERATIONS      │
   │  (CV / lightweight   │        │  (Shapely/GeoPandas): │
   │  DL: boundary/roof   │        │  IoU, area calc,      │
   │  segmentation on     │        │  centroid distance,   │
   │  drone/ORI imagery)  │        │  topology checks       │
   └──────────┬───────────┘        └───────────┬───────────┘
              └───────────────┬────────────────┘
                              ▼
                    ┌───────────────────┐
                    │ RECONCILIATION /  │   spatial + boundary + area +
                    │ MATCHING ENGINE   │   attribute similarity →
                    │ (rules + small ML │   match score (XGBoost/LogReg,
                    │  classifier)      │   not a from-scratch deep net)
                    └─────────┬─────────┘
                              ▼
                    ┌───────────────────┐
                    │ CONFIDENCE ENGINE │   weighted score → band
                    └─────────┬─────────┘
                 ┌────────────┼────────────┐
                 ▼            ▼            ▼
              HIGH         MEDIUM         LOW
           AUTO-ACCEPT     REVIEW         CONFLICT
                 │            │            │
                 └────────────┴────────────┘
                              ▼
                    ┌───────────────────┐
                    │ REVIEW DASHBOARD  │   = today's admin/verify UI,
                    │ (frontend, reused)│   generalized to any conflict
                    └─────────┬─────────┘   type, not just "unassessed"
                              ▼
                    ┌───────────────────┐
                    │  MASTER PARCEL DB │   RDS MySQL + spatial columns
                    │  (source lineage, │   (or PostGIS if migrated —
                    │  confidence,      │   see §6 migration note)
                    │  audit trail)     │
                    └─────────┬─────────┘
                              ▼
                    ┌───────────────────┐
                    │  WEB-GIS + API    │   React + Leaflet (reused) +
                    │  export endpoints │   REST/GeoJSON export for
                    │                   │   inter-department exchange
                    └───────────────────┘
```

---

## 4. Data model changes (minimum viable, backward-compatible)

The existing tables are **not thrown away** — `wards` becomes one row in a generic `datasets` registry, and `properties` becomes one flavor of `source_records`.

```sql
-- Registry of every uploaded dataset, of any type
datasets(
  dataset_id, source_type ENUM('drone','ori','dsm_dtm','cadastral',
    'revenue','municipal','utility','ground_truth','gnss','building_footprint'),
  ward_id, uploaded_by, uploaded_at, crs_original, file_ref_s3, status
)

-- One row per input record from any source, geometry already reprojected
source_records(
  source_record_id, dataset_id, external_id, geometry, area_sqm,
  attributes_json, land_use, created_at
)

-- Canonical harmonized parcel — one per real-world property
parcels(
  parcel_id, ulpin_reference, geometry, area_sqm, land_use,
  confidence_score, status ENUM('auto_accepted','pending_review',
  'conflict','resolved'), created_at, updated_at
)

-- Which source records feed a given master parcel
parcel_sources(parcel_id, source_record_id, match_score)

-- Detected disagreements between sources
conflicts(
  conflict_id, parcel_id, conflict_type ENUM('area_mismatch',
  'boundary_shift','overlap','gap','duplicate','attribute_mismatch'),
  severity, description, confidence, status
)

-- Full audit trail (already implied by `properties.verify`, made explicit)
audit_log(
  audit_id, parcel_id, actor, action, old_value_json, new_value_json,
  reason, timestamp
)
```

Migration path: `wards` → `datasets` (source_type='municipal'), `properties` → `source_records` + `parcels`, `alerts` → generated from `conflicts`. Existing frontend calls (`/api/wards`, `/api/wards/{id}/changes`, `/api/wards/{id}/alerts`, `/api/properties/{id}/verify`) keep working by having the Lambda route them onto the new tables — **no frontend rewrite required**, only the response-shaping layer changes.

---

## 5. Pipeline stages, mapped to concrete, shippable tools

| Stage | Tool | Why this and not more |
|---|---|---|
| Ingestion | Extend existing `admin/upload-csv` pattern + new S3-direct upload for raster/vector | Reuses the exact upload/presigned-URL pattern already proven in `backend` |
| CRS normalization | `pyproj`, `geopandas` | Standard, no training needed, always correct |
| Schema harmonization | Static field-mapping table (`parcel_no→parcel_id`, `plot_id→parcel_id`, etc.), not a learned mapper | Deterministic and auditable — appropriate for a legal/land-records context |
| Feature extraction from imagery | A **pretrained** segmentation model (e.g. a SAM/U-Net checkpoint) fine-tuned lightly if labelled parcels are available; otherwise run as unsupervised contour extraction on ORI/drone tiles | No claim of training a large model from scratch on a hackathon timeline |
| Spatial matching | Shapely `IoU`, boundary distance, centroid distance — combined by a small classifier (Logistic Regression / XGBoost) trained on a **synthetic conflict dataset** (real polygons + injected shift/rotate/scale/noise) | Matches the PS's "AI/ML-based spatial matching" honestly, at a scale the team can actually validate and explain in a demo |
| Topology correction | Shapely (`overlaps`, `touches`, `contains`, `is_valid`), auto-fix trivial invalid geometries (self-intersections via `buffer(0)`), everything else routed to human review | Keeps a hard geometric guarantee: DL/heuristics *propose*, GIS *validates* |
| Confidence scoring | Weighted sum of (spatial IoU, boundary similarity, area consistency, attribute match, source reliability) — weights documented as configurable prototype parameters, not official thresholds | Transparent, explainable, defensible to a judge or an officer |
| Conflict routing | Threshold bands (e.g. ≥90 auto-accept, 60–90 review, <60 conflict) — again explicitly a tunable prototype default | Directly reuses the `verify` (`accept/reject/notes`) action already built |
| Explanations | Keep the existing `bedrock_client.py` **interface** (`explain_property`/`explain_conflict`, same templated fallback), but swap the model call behind it to a free option — see §10 | Bedrock bills per token with no perpetual free tier; the fallback-safe function signature means this swap touches one file, not the callers |
| Export/interoperability | REST endpoints returning GeoJSON/CSV; optional WFS-style OGC wrapper later | Meets "seamless inter-departmental exchange" without inventing a new protocol |

---

## 6. Infrastructure decision: stay on MySQL, or move to PostGIS?

- **Recommended for the SIH timeline:** keep RDS MySQL for `datasets`/`parcels`/`conflicts`/`audit_log` metadata (already deployed, already working), and do all actual geometry math (IoU, topology, CRS transforms) **in the `pipeline` worker using GeoPandas/Shapely**, storing final geometries as GeoJSON text/BLOB in MySQL. This avoids a database migration under deadline pressure.
- **Documented upgrade path, not required now:** if native spatial indexing (`ST_Intersects`, `ST_Area`) is ever needed at scale, don't reach for `RDS PostgreSQL` (billed, no perpetual free tier) — use a **free-tier managed Postgres with PostGIS pre-enabled**, e.g. **Supabase** (500MB free Postgres, PostGIS is a one-click extension) or **Neon** (free serverless Postgres, PostGIS supported). Both are enough for a hackathon-scale dataset and need zero server management. The `pipeline` module should be written against GeoPandas so this swap only touches the persistence layer, not the matching logic.

This keeps the plan **technically feasible on the infrastructure already deployed**, while being honest that PostGIS is the correct production answer.

---

## 7. Making it easy to manage from the user (officer/admin) end

The current `admin` domain (CSV upload, DB config, refresh trigger) is the right instinct — it's extended, not replaced:

1. **One upload screen, many dataset types** — a single "Add Dataset" form in the existing admin UI, with a dropdown for source type (drone/ORI/DSM/GNSS/etc.) instead of a hardcoded CSV-only property importer.
2. **One review queue, not scattered alerts** — the existing `alerts` list becomes a unified **Conflict Review Dashboard**: filterable by ward, conflict type, and severity, with the same `[ACCEPT] [REJECT] [EDIT]` pattern already implemented for property verification.
3. **Map-first navigation** — Leaflet map (already integrated) colors parcels by status (green = auto-accepted, yellow = pending review, red = conflict), so an officer never has to read a table to know where attention is needed.
4. **Plain-language explanations, not raw scores** — Bedrock (already wired) turns "IoU 0.63, area diff 18%" into a one-sentence reason, exactly as it already does for `ai_explanation`.
5. **Every action is logged and reversible** — `audit_log` means no officer decision is silent or unrecoverable, addressing both governance and trust requirements implicit in "digital land governance."
6. **No new login system to learn** — since the current system is a public demo API with no auth, the plan explicitly keeps role separation (officer vs. viewer) as a **post-hackathon hardening item**, not a blocker for the prototype; it's called out here so it isn't forgotten before any real deployment.

---

## 8. Explicit non-goals (to keep the claim of feasibility honest)

- Not training a large segmentation model from scratch — pretrained/fine-tuned only, or classical CV contour extraction if labelled imagery isn't available in time.
- Not implementing all 10 source types with equal depth for the demo — **recommended MVP subset: municipal (existing), drone/ORI (imagery-based change detection, already partially built), cadastral, and revenue** (tabular), which together already demonstrate matching, conflict, and confidence end-to-end. GNSS/utility/DSM-DTM/GT/building-footprint are supported by the same generic `datasets`/`source_records` schema and can be enabled by adding an ingestion adapter, without further architecture changes.
- Not asserting the system replaces or issues ULPIN — it stores a ULPIN-style reference field for interoperability, consistent with the original proposal, without claiming authority over the actual national indexing scheme.
- Not building a full OGC WFS/WMS server for this phase — plain REST + GeoJSON export satisfies "interoperability" for a prototype; OGC compliance is noted as a future extension.

---

## 9. Delivery milestones

| Milestone | Scope | Builds on |
|---|---|---|
| M1 — Schema migration | Add `datasets`, `source_records`, `parcels`, `parcel_sources`, `conflicts`, `audit_log`; backfill from existing `wards`/`properties`/`alerts` | `backend/schema.sql` |
| M2 — Multi-source ingestion | Generic upload endpoint + CRS normalization + schema harmonizer for 4 MVP source types | `backend/admin`, new `pipeline` worker |
| M3 — Matching + topology | IoU/boundary/area similarity, Shapely topology checks, synthetic conflict dataset for validation | `pipeline` repo |
| M4 — Confidence + conflict routing | Weighted scoring, auto-accept/review/conflict bands, conflict generation replacing static alerts | `backend/alerts`, `backend/stats` |
| M5 — Review dashboard | Generalize `properties.verify` UI into the Conflict Review Dashboard, map status coloring | `frontend` |
| M6 — Explanations + export | Bedrock reason generation for conflicts, GeoJSON/CSV export endpoints | `backend/chat`, `backend/shared/bedrock_client.py` |
| M7 — Demo hardening | Seed realistic multi-source sample data, rehearse end-to-end walkthrough, document known tradeoffs | `backend/seed` |

---

## 10. Free & low-cost resource substitutions

The rule used throughout this section: **keep AWS only where it's already deployed and free at this scale; pick free/open-source for everything new.**

| Need | Paid/heavier default | Free substitution | Notes |
|---|---|---|---|
| API compute | AWS Lambda | **Keep as-is** | Already deployed, well within the AWS Lambda free tier (1M requests/month) for a demo |
| Object storage (imagery, GeoJSON) | AWS S3 | **Keep as-is**, or **Cloudflare R2** (10GB free, no egress fees) if S3 free-tier storage (5GB) gets tight with drone imagery | Only move if you actually hit the limit — don't migrate pre-emptively |
| Relational DB | AWS RDS MySQL (billed after 12-month free tier) | **Keep the existing instance if still in its free tier**; otherwise move to **PlanetScale free tier**, **Railway free tier**, or a **local MySQL/SQLite** for dev | RDS's free tier is time-limited (12 months), not perpetual — worth checking before demo day |
| Spatial DB (if/when PostGIS is needed) | AWS RDS PostgreSQL | **Supabase** (free Postgres + one-click PostGIS) or **Neon** (free serverless Postgres + PostGIS) | See §6 — neither requires a credit card for the free tier |
| LLM for explanations (`explain_property`/`explain_conflict`/chat) | AWS Bedrock (Llama, billed per token) | **Groq API free tier** (very fast, generous free rate limits, hosts Llama/Mixtral models) or **Google AI Studio's Gemini free tier**, or **Ollama running a small local model** (e.g. `llama3.2:3b`) on your own laptop for zero cost, zero internet dependency during dev | Keep `bedrock_client.py`'s function signatures (`explain_property(prop)`, `explain_conflict(...)`) unchanged — only the internals of `_invoke_llama` change to call a different HTTP endpoint; the try/except templated-fallback pattern already in the code is what makes this swap safe |
| DL feature extraction (imagery segmentation) | Paid cloud GPU (SageMaker, EC2 GPU instances) | **Google Colab free tier** (free T4 GPU, enough for inference and light fine-tuning of a pretrained U-Net/SAM checkpoint) or **Kaggle Notebooks** (also free GPU hours) | Run this offline/in-notebook, export the trained/fine-tuned weights, and only run **inference** in the actual pipeline — don't try to train inside Lambda either way |
| Async/heavy pipeline stages (see `deferred_scope.md` §3) | Dedicated EC2 worker | **GitHub Actions free minutes** (2,000 min/month on free tier) as a scheduled/triggered job runner, or run the worker on your **own machine** during the hackathon and only move to cloud if a live public demo needs it always-on | An EC2 instance left running is the single easiest way to accidentally leave AWS's free tier |
| OGC/WFS export (deferred item, see `deferred_scope.md` §7) | GeoServer on a paid VM | **GeoServer Docker image run locally**, or skip entirely for the SIH demo — plain REST/GeoJSON already satisfies "interoperability" for a prototype (§5) | Only worth spinning up if a specific judge/partner explicitly wants to plug in QGIS |
| Frontend hosting | AWS Amplify (has a free tier, generous enough to keep) | **Keep as-is**, or **Vercel/Netlify free tier** as a backup if Amplify's free tier is ever a concern | No change needed unless costs actually show up |

### What this means concretely for the build plan

- **B6** in `build_plan.md` (wire `explain_conflict` into `bedrock_client.py`) should be read as "wire `explain_conflict` into whichever LLM backend §10 lands on" — the code in `build_plan.md` §6 is written against the existing `_invoke_llama` helper precisely so this is a one-function swap, not a rewrite.
- **§1d in `deferred_scope.md`** (DSM/DTM raster support) and **§8** (DL segmentation) should both be prototyped in a free Colab/Kaggle notebook first, and only wired into the live pipeline once the approach is validated — never spend free-tier Lambda time on model experimentation.
- Nothing in **§9's milestone table** (M1–M7) requires a paid resource to complete; the only genuinely optional paid step in the entire plan is a dedicated EC2 pipeline worker, which §10 replaces with either GitHub Actions or a local machine for the demo period.

---

## 11. One-paragraph pitch (for the SIH presentation)

> Horcrux ingests multi-source land data — drone imagery, ORI, cadastral maps, revenue and municipal records, and (extensibly) DSM/DTM, GNSS, utility, ground-truth, and building-footprint datasets — through a single harmonization pipeline. Lightweight computer-vision/DL extracts features from imagery where available; GIS operations (CRS normalization, IoU, topology checks) always validate the result; a transparent, weighted confidence engine decides what can be auto-accepted versus what needs officer review; and every decision — automatic or human — is logged against a single harmonized master parcel with source lineage. The system builds directly on Horcrux's already-deployed change-detection and verification workflow, generalizing it from one municipality's imagery-vs-register comparison into a full multi-source reconciliation engine, without discarding any working infrastructure.
