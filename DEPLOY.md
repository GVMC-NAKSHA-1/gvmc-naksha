# GVMC-NAKSHA — Deployment Guide

Practical, step-by-step runbook for taking this repo from "runs locally with `docker compose up`"
to a live deployment. For the full architecture/spec/API reference see `final.md`; for the
complete env-var reference see `key.md`. This file only tells you what to click/run, in order.

> **Where things stand today:** every planned module (backend, frontend, worker, DB migrations)
> is written and boots locally with **zero external accounts**. Going live is mostly about
> creating a handful of external services and wiring real credentials — not writing more code.
> See the "What's required vs optional" table below and the Appendix for the full gap list.

---

## 1. Architecture at a glance

```
                     ┌───────────────┐        ┌──────────────────┐
   Browser  ───────► │  Vercel        │──────► │  Backend (NestJS) │──┐
                     │  (frontend/)   │  REST  │  Docker host       │  │
                     └───────────────┘        └──────────────────┘  │
                                                        │             │
                                                        ▼             ▼
                                              ┌────────────┐   ┌────────────┐
                                              │  Worker     │   │  Supabase   │
                                              │  (Python)   │   │  Postgres/  │
                                              │  Docker host│   │  PostGIS +  │
                                              └────────────┘   │  Auth       │
                                                     │           └────────────┘
                            ┌────────────────────────┼───────────────┐
                            ▼                        ▼               ▼
                    ┌──────────────┐        ┌──────────────┐  ┌─────────────┐
                    │ Cloudflare R2 │        │ Upstash Redis │  │ Groq (LLM)  │
                    │ (object store)│        │ (job queue)   │  │ optional    │
                    └──────────────┘        └──────────────┘  └─────────────┘
```

Backend and worker are built and pushed as Docker images to GHCR by GitHub Actions, then
pulled and run on any Docker host you control over SSH. Frontend deploys to Vercel. Everything
else (DB/Auth, storage, queue, LLM, maps, email) is an external managed service.

### What's required vs optional to go live

| Service | Required for | If skipped |
|---|---|---|
| **Supabase** (Postgres+PostGIS, Auth) | Real data persistence, real login | Falls back to local dev-bypass auth + throwaway data — fine for a demo, not for prod |
| **Cloudflare R2** | Uploading source files, exporting the harmonized cadastre | Everything else (matching, conflicts, golden-record assembly, inline GeoJSON) still works; uploads/exports don't |
| **Upstash Redis** | Background job queue (ingest, harmonize, assemble) in prod | Must run your own Redis container instead |
| **A Docker host** (any VM with SSH) | Running the backend API + worker in prod | No way to serve the API outside your laptop |
| **Vercel** | Hosting the frontend | No way to serve the UI outside `npm run dev` |
| Groq API key | AI-generated chat answers / briefs / alerts / schema mapping | Those features return templated/deterministic text instead of a 500 |
| Brevo API key | Sending ward-alert / ticket-review emails | Emails are skipped (logged, non-fatal) |

---

## 2. Prerequisites

- GitHub account/org with `gh` CLI authed (`gh auth status`), `repo` + `workflow` scopes.
- A small VM/box you control with Docker + Docker Compose installed, reachable over SSH
  (any cloud VM, a home server, etc. — no specific provider required).
- Accounts (all have free tiers): **Cloudflare**, **Supabase**, **Upstash**, **Vercel**,
  **Groq** (optional), **Google Cloud** (optional, Maps JS API), **Brevo** (optional).
- Docker + Docker Compose installed locally for the sanity check in Step 1.

---

## 3. Step 1 — Local sanity check first

Confirm the baseline works before touching production infra.

```bash
cp .env.example .env            # leave everything blank
docker compose up --build       # db + redis + migrate + api + worker
```

In another shell:

```bash
cd frontend && npm install && npm run dev   # http://localhost:3001
```

Verify:

```bash
curl localhost:3000/api/health
# {"status":"ok","db":"ok","redis":"ok","r2":"down"}   <- r2 "down" is expected, no keys yet
```

Run the demo harmonization pipeline (see `final.md` §15 for full detail):

```bash
curl -X POST "localhost:3000/api/harmonization/run?wardId=4" -H "x-dev-role: admin"
curl "localhost:3000/api/harmonized/export?wardId=4&format=geojson" -H "x-dev-role: admin"
```

Open `http://localhost:3001`, pick a workspace, and click through the dashboards.
If this all works, you're ready to move to real infrastructure.

---

## 4. Step 2 — Provision external services

Do these in order; later steps need the values produced here.

### 4.1 Supabase (Postgres + PostGIS + Auth)

1. Create a project at supabase.com.
2. Settings → Database → connection string → this is your `DATABASE_URL` (use the pooled
   "Transaction" connection string for the backend).
3. Run the migrations against it:
   ```bash
   psql "$DATABASE_URL" -f database/migrations/0001_*.sql   # repeat 0001..0011 in order
   psql "$DATABASE_URL" -f database/seed/seed.sql            # wards + admin config
   ```
   (Or adapt `database/migrate.sh`, which applies all of them in order automatically.)
4. Settings → API → grab `SUPABASE_URL` (also `VITE_SUPABASE_URL`, same value),
   `SUPABASE_ANON_KEY` (also `VITE_SUPABASE_ANON_KEY`), and `SUPABASE_SERVICE_ROLE_KEY`
   (backend only — **never** ship this to the browser).
5. Set `AUTH_DEV_BYPASS=false` and `PROFILES_SOURCE=supabase` once this is wired.

### 4.2 Cloudflare R2 (object storage)

1. Cloudflare dashboard → R2 → create buckets: `gvmc-data`, `gvmc-photos`, `gvmc-documents`,
   `gvmc-logs` (or one bucket if you'd rather keep it simple — the code just needs
   `R2_BUCKET_NAME`).
2. R2 → Manage API Tokens → create a token scoped to **Object Read & Write** on those buckets.
3. Grab `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET_NAME`.
4. On the bucket → Settings → CORS Policy, allow `PUT`/`GET` from your frontend origin
   (e.g. `https://app.yourdomain.com`, plus `http://localhost:3001` while testing).
5. Leave `R2_ENDPOINT` blank (only needed to point at MinIO/LocalStack instead of real R2).

### 4.3 Upstash Redis (job queue)

1. Create a Redis database at upstash.com (free tier is fine to start).
2. Grab the `REDIS_URL` (rediss:// TLS connection string).

### 4.4 Groq (optional — LLM features)

1. console.groq.com/keys → create an API key → `GROQ_API_KEY`.
2. Without this, `/chat`, `/brief`, alerts, and schema-mapping still work but return
   templated/deterministic output instead of LLM output.

### 4.5 Map basemap (no key needed)

The frontend uses MapLibre GL with OpenStreetMap (streets) and Esri World Imagery (satellite)
raster tiles — nothing to configure. For heavy production traffic, switch `BASE_STYLE` in
`frontend/src/components/mapStyle.js` to a tile provider you have an agreement with (OSM's public
tile servers are for light use only).

### 4.6 Brevo (optional — email alerts)

1. Create a Brevo account, verify a sender under Senders, Domains & Dedicated IPs.
2. Grab `BREVO_API_KEY`, set `BREVO_SENDER_EMAIL` / `BREVO_SENDER_NAME`.
3. Blank sender email → alert emails are skipped (logged, non-fatal), not an error.

---

## 5. Step 3 — Push the repo to GitHub

```bash
git init -b main                     # if not already a repo
git add -A
git status                           # confirm: no .env, no node_modules, no *.pem
git commit -m "feat: GVMC-NAKSHA deployable baseline"

gh repo create <org-or-user>/gvmc-naksha \
  --private --source . --remote origin --push \
  --description "GVMC-NAKSHA — geospatial land-record integration & harmonization"
```

Protect `main` and gate production deploys behind a required reviewer:

```bash
gh api -X PUT repos/<org-or-user>/gvmc-naksha/branches/main/protection \
  -H "Accept: application/vnd.github+json" \
  -f "required_pull_request_reviews[required_approving_review_count]=1" \
  -F "enforce_admins=true" -F "required_status_checks=null" -F "restrictions=null"
```

Then in the repo: **Settings → Environments → New environment `production`** → enable
*Required reviewers* (add yourself). `deploy-backend.yml` and `deploy-worker.yml` already
declare `environment: production`, so merges to `main` will wait for your approval before
touching the live host.

---

## 6. GitHub Actions: Secrets vs Variables

GitHub repos have **two** places under Settings → Secrets and variables → Actions: a
**Secrets** tab (encrypted, masked in logs — use for anything sensitive) and a **Variables**
tab (plain text — use for non-sensitive config). Checking the four workflow files in this repo
directly (`test.yml`, `deploy-backend.yml`, `deploy-worker.yml`, `deploy-frontend.yml`): **none
of them read `vars.*`.** Every value they need is a `secrets.*` reference, so **you only need
GitHub Secrets here — zero repo Variables are required** for this project as it stands today.

### What the workflow YAML itself reads (must be Secrets)

Only these three are actually referenced inside `deploy-backend.yml` / `deploy-worker.yml`:

| Secret | Used by |
|---|---|
| `DEPLOY_HOST` | SSH target hostname/IP |
| `DEPLOY_USER` | SSH username |
| `DEPLOY_SSH_KEY` | SSH **private** key matching the public key on the host |

`GITHUB_TOKEN` is provided automatically by GitHub Actions for GHCR login — never set it
yourself.

### App/runtime secrets (not read by the workflow, but store them as Secrets too)

These aren't referenced in the workflow YAML — they're consumed by the running app via the
host's `.env` file — but keep them as GitHub Secrets as your canonical, encrypted copy so
you're not passing them around some other way:

`DATABASE_URL`, `REDIS_URL`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `GROQ_API_KEY`,
`R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET_NAME`, `BREVO_API_KEY`,
`BREVO_SENDER_EMAIL`.

Set them all in one go:

```bash
for s in DEPLOY_HOST DEPLOY_USER DEPLOY_SSH_KEY \
         DATABASE_URL REDIS_URL SUPABASE_URL SUPABASE_SERVICE_ROLE_KEY GROQ_API_KEY \
         R2_ACCOUNT_ID R2_ACCESS_KEY_ID R2_SECRET_ACCESS_KEY R2_BUCKET_NAME \
         BREVO_API_KEY BREVO_SENDER_EMAIL; do
  gh secret set "$s" --repo <org-or-user>/gvmc-naksha
done
```

### Only if using Option B for the frontend (§8)

If you deploy the frontend via `deploy-frontend.yml` instead of Vercel's Git integration, also
set: `VERCEL_TOKEN`, `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID` (read directly in that workflow).

### What about the frontend's `VITE_*` values?

Those (`VITE_API_URL`, `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` — the older
`NEXT_PUBLIC_*` names are still accepted) are **not** GitHub Secrets or Variables — with Option A
(recommended) they live entirely in the Vercel dashboard's Environment Variables page. They
only need to exist on the GitHub side if you're using Option B, where Vercel's own CLI (`vercel
pull`) fetches them from your already-configured Vercel project — you still set them in Vercel,
not in GitHub.

### If you add non-sensitive config later

Should you ever need a genuinely non-secret config knob (e.g. a log level or a region name)
that a workflow reads directly, that's what GitHub **Variables** (`gh variable set NAME
value`) are for. Nothing in this repo needs one today.

---

## 7. Step 4 — Backend + worker deployment (Docker host)

The existing workflows (`.github/workflows/deploy-backend.yml`,
`.github/workflows/deploy-worker.yml`) already do this on every push to `main`:
1. Build the Docker image from `backend/` or `worker/`.
2. Push it to GHCR (`ghcr.io/<owner>/gvmc-backend` / `gvmc-worker`) — uses the built-in
   `GITHUB_TOKEN`, **no secret needed** for this part.
3. Wait for the `production` environment reviewer approval.
4. SSH into `DEPLOY_HOST` as `DEPLOY_USER` and run `docker pull` + `docker compose up -d`.

To make that work:

1. **Prepare the host** — any VM with Docker + Docker Compose installed and an SSH key you
   control. Generate a deploy key pair and add the public key to the host's
   `~/.ssh/authorized_keys`.
2. **Copy compose + env to the host**, e.g. `/opt/gvmc/docker-compose.yml` and `/opt/gvmc/.env`
   (real values this time — Supabase `DATABASE_URL`, real `REDIS_URL`, real R2 keys,
   `AUTH_DEV_BYPASS=false`, `FRONTEND_ORIGIN=https://app.yourdomain.com`). If Supabase is your
   Postgres, drop the bundled `db` service from `docker-compose.yml` on the host — you don't
   need a second Postgres.
3. **Set GitHub Actions secrets** — see §6 above for the full list and the `gh secret set`
   loop. `DEPLOY_SSH_KEY` is the **private** key matching the public key you installed on the
   host.
4. **Trigger a deploy** by merging a PR that touches `backend/**` (or `worker/**`) into `main`,
   then approve the `production` environment gate when prompted.

---

## 8. Step 5 — Frontend deployment (Vercel)

Pick **one** of these two paths — don't run both.

**Option A — Vercel Git integration (simplest, recommended):**
1. vercel.com → Import Project → select your GitHub repo.
2. Root Directory = `frontend/`.
3. Project → Settings → Environment Variables, set:
   - `VITE_API_URL` → `https://api.yourdomain.com` (your backend's public URL)
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY`

   These are baked in at build time — redeploy after changing them. `frontend/vercel.json` sets the
   Vite framework preset and the SPA rewrite so deep links like `/officer` work.
4. Every push to `main` auto-deploys. You can disable/delete `.github/workflows/deploy-frontend.yml`
   if you use this path, to avoid a duplicate deploy.

**Option B — GitHub Actions workflow (`deploy-frontend.yml`):**
1. Create a Vercel project as above but skip its Git integration (or disconnect it).
2. Set `VERCEL_TOKEN`, `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID` as GitHub Secrets (see §6).
3. The existing workflow runs `vercel deploy` on push to `main`.

---

## 9. Step 6 — DNS and network hardening

1. Cloudflare DNS: `app.yourdomain.com` → Vercel (CNAME per Vercel's instructions);
   `api.yourdomain.com` → your Docker host's IP (A/AAAA record), proxied through Cloudflare.
2. Set the backend's `FRONTEND_ORIGIN` (in the host's `.env`) to `https://app.yourdomain.com`
   so CORS allows the real frontend.
3. Cloudflare → WAF: add rate limits on `/chat`, `/sources/upload`, `/harmonization/*`,
   `/harmonized/*`, `/properties/*/explain` — these are the most expensive/abusable routes.
4. Enable HTTPS-only (Cloudflare "Always Use HTTPS").

---

## 10. Step 7 — Post-deploy verification

```bash
curl https://api.yourdomain.com/api/health
# expect {"status":"ok","db":"ok","redis":"ok","r2":"ok"}   <- all three now "ok"
```

- Re-run the same harmonization smoke test from Step 1, but against
  `https://api.yourdomain.com`.
- Open `https://app.yourdomain.com`, sign in via real Supabase Auth, confirm each dashboard
  loads with no `401`s, and that layer toggles / conflict resolve / export work.
- Upload a real source file end-to-end (`POST /api/sources/upload` → PUT to the presigned R2
  URL) to confirm R2 credentials and CORS are correct.

---

## 11. Security checklist before go-live

```text
[ ] HTTPS everywhere (Cloudflare TLS)
[ ] MFA on all GitHub / Supabase / Cloudflare / Vercel accounts
[ ] No secrets in source; .env.* gitignored, .env.example kept
[ ] DATABASE_URL / GROQ_API_KEY / R2 keys / SERVICE_ROLE_KEY set only as CI + host secrets
[ ] Supabase service-role key server-side only (never shipped to the browser)
[ ] Groq API key server-side only (all LLM calls via NestJS LlmService or the worker)
[ ] R2 buckets private by default; signed URLs for every download; presigned PUT (300s) for uploads
[ ] Supabase Auth required on protected routes; @Roles enforced in AuthGuard
[ ] Frontend Server Components fetch via lib/server-api.ts — never a bare fetch to /api
[ ] Postgres RLS evaluated for any citizen-facing reads
[ ] Cloudflare WAF + rate limits on /chat /sources/upload /harmonization/* /harmonized/* /properties/*/explain
[ ] AUTH_DEV_BYPASS=false in every deployed environment
[ ] audit_logs row confirmed for source ingest, conflict resolution, verify transitions
[ ] Free-tier quotas checked: Supabase storage, R2 egress, Upstash commands, Groq usage, GitHub Actions minutes, Vercel bandwidth
```

---

## Appendix A — Full environment variable reference

(For the GitHub Secrets vs Variables breakdown specifically, see §6.)

| Var | Where it's set | Required? | Purpose |
|---|---|---|---|
| `DATABASE_URL` | host `.env`, GH secret | ✅ prod | Postgres/PostGIS DSN (Supabase in prod; blank = bundled container locally) |
| `REDIS_URL` | host `.env`, GH secret | ✅ prod | Upstash Redis job queue (blank = bundled container locally) |
| `AUTH_DEV_BYPASS` | host `.env` | must be `false` in prod | `true` = no-auth dev mode; **never** set `true` on a deployed env |
| `PROFILES_SOURCE` | host `.env` | when auth bypass off | `local` or `supabase` |
| `SUPABASE_URL` / `VITE_SUPABASE_URL` | host `.env` / Vercel | ✅ prod | Supabase project URL |
| `SUPABASE_ANON_KEY` / `VITE_SUPABASE_ANON_KEY` | Vercel | ✅ prod | client-side auth |
| `SUPABASE_SERVICE_ROLE_KEY` | host `.env`, GH secret | ✅ prod | backend-only, verifies JWTs / admin ops |
| `R2_ACCOUNT_ID` / `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY` / `R2_BUCKET_NAME` | host `.env`, GH secret | ✅ for uploads/export | Cloudflare R2 |
| `R2_ENDPOINT` | host `.env` | optional | override for MinIO/LocalStack instead of R2 |
| `GROQ_API_KEY` | host `.env`, GH secret | optional | LLM chat/brief/alerts/schema-map |
| `VITE_API_URL` / `API_URL` | Vercel / host `.env` | ✅ prod | backend base URL the frontend calls |
| `FRONTEND_ORIGIN` | host `.env` | ✅ prod | CORS allow-list |
| `BREVO_API_KEY` / `BREVO_SENDER_EMAIL` / `BREVO_SENDER_NAME` | host `.env`, GH secret | optional | transactional email alerts |
| `RESEND_API_KEY` | — | not used yet | reserved placeholder, no code reads it today |
| `WAZUH_HOST` | — | not used yet | reserved placeholder for SIEM log shipping |
| `DEPLOY_HOST` / `DEPLOY_USER` / `DEPLOY_SSH_KEY` | GH secret only | ✅ for CI deploy | SSH target for `deploy-backend.yml` / `deploy-worker.yml` |
| `VERCEL_TOKEN` / `VERCEL_ORG_ID` / `VERCEL_PROJECT_ID` | GH secret | only if using Option B in §7 | CLI-driven Vercel deploy |

Full narrative version of this table lives in `key.md`.

## Appendix B — Known gaps / roadmap (not blockers, but good to set expectations on)

- **No automated tests yet** — `test.yml` currently passes trivially (`--passWithNoTests` for
  the backend, pytest exit-5 "no tests collected" for the worker).
- **B.8 drone/imagery module is a stub** — ingests a flagged bounding box + confidence only,
  no actual computer-vision feature extraction.
- Several PS 26013 "advanced AI/GIS" capabilities are intentionally deferred beyond MVP
  (see `final.md` §16 for the full table): a learned/ML spatial-match scorer (currently a
  deterministic IoU/centroid/name-overlap blend), full parcel-fabric topology correction
  (snap/rebuild/sliver removal — only basic geometry-validity fixing exists today),
  GCP-based georeferencing of raw drone/scanned imagery, DSM/DTM per-parcel height/slope
  analysis, dataset change/version detection, CV-based building/road feature extraction,
  LLM-suggested conflict auto-resolution, incremental (vs. full) re-harmonization, an
  OGC API - Features endpoint, and LGD/DILRMP field alignment.

None of these block a working deployment — they're feature depth to add after go-live.
