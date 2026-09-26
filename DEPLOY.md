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
                     │  (frontend/)   │  REST  │  Railway           │  │
                     └───────────────┘        └──────────────────┘  │
                                                        │             │
                                                        ▼             ▼
                                              ┌────────────┐   ┌────────────┐
                                              │  Worker     │   │  Supabase   │
                                              │  (Python)   │   │  Postgres/  │
                                              │  Railway    │   │  PostGIS +  │
                                              └────────────┘   │  Auth       │
                                                     │           └────────────┘
                            ┌────────────────────────┼───────────────┐
                            ▼                        ▼               ▼
                    ┌──────────────┐        ┌──────────────┐  ┌─────────────┐
                    │ Cloudflare R2 │        │ Railway Redis │  │ Groq (LLM)  │
                    │ (object store)│        │ (job queue)   │  │ optional    │
                    └──────────────┘        └──────────────┘  └─────────────┘
```

Backend API and worker run on **Railway**, which builds each one from its Dockerfile on every
push to `main` (no server, no SSH). Frontend deploys to Vercel the same way. Everything
else (DB/Auth, storage, queue, LLM, maps, email) is an external managed service.

### What's required vs optional to go live

| Service | Required for | If skipped |
|---|---|---|
| **Supabase** (Postgres+PostGIS, Auth) | Real data persistence, real login | Falls back to local dev-bypass auth + throwaway data — fine for a demo, not for prod |
| **Cloudflare R2** | Uploading source files, exporting the harmonized cadastre | Everything else (matching, conflicts, golden-record assembly, inline GeoJSON) still works; uploads/exports don't |
| **Redis** (Railway Redis) | Background job queue (ingest, harmonize, assemble) in prod | Jobs never run |
| **Railway** (Hobby plan) | Running the backend API + worker in prod | No way to serve the API outside your laptop |
| **Vercel** | Hosting the frontend | No way to serve the UI outside `npm run dev` |
| Groq API key | AI-generated chat answers / briefs / alerts / schema mapping | Those features return templated/deterministic text instead of a 500 |
| Brevo API key | Sending ward-alert / ticket-review emails | Emails are skipped (logged, non-fatal) |

---

## 2. Prerequisites

- GitHub account/org with `gh` CLI authed (`gh auth status`), `repo` + `workflow` scopes.
- A **Railway** account (sign in with GitHub; Hobby plan, $5/month including $5 of usage).
- Accounts (all have free tiers): **Cloudflare**, **Supabase**, **Vercel**,
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

### 4.3 Redis (job queue)

Use **Railway's Redis** (added in §7), in the same project as the API and worker. Don't use
Upstash's free tier: the worker's crash-safe queue loop (blocking move, heartbeat, retry
promotion, orphan sweep) sends roughly 50k commands a day even when idle, far beyond Upstash's
free command quota. Railway Redis has no per-command limit and is reached over the private
network.

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

**No GitHub Secrets or Variables are needed.** The only workflow left is `test.yml` (tests and
builds on every push/PR), and it reads none. Deploys happen outside GitHub Actions:

- **Frontend** → Vercel's Git integration (§8); its `VITE_*` values live in Vercel.
- **Backend + worker** → Railway's Git integration (§7); their runtime values (`DATABASE_URL`,
  `REDIS_URL`, `SUPABASE_*`, `GROQ_API_KEY`, `R2_*`, `BREVO_*`, …) live in Railway's Variables.

Keep your own encrypted copy of those values (a password manager) — Railway and Vercel are the
places the running app reads them from.

The earlier SSH deploy (`deploy-backend.yml` / `deploy-worker.yml` with `DEPLOY_HOST`,
`DEPLOY_USER`, `DEPLOY_SSH_KEY`, images on GHCR) was removed in favour of Railway; it is in git
history if you ever move to your own VM.

---

## 7. Step 4 — Backend + worker deployment (Railway)

Railway builds `backend/` and `worker/` from their Dockerfiles on every push to `main`.
`backend/railway.json` and `worker/railway.json` hold the build and restart settings; each
service only rebuilds when files in its own folder change.

1. **Create the project** — railway.com → sign in with GitHub → **New Project → Deploy from
   GitHub repo** → pick `GVMC-NAKSHA-1/gvmc-naksha`. Rename the created service to `api`.
   It is a monorepo: if Railway offers to create several services from it, keep only the
   backend and worker ones and delete any for `frontend/`, `data/` or `database/` (the frontend
   is on Vercel, the database is Supabase). The first build may fail before step 2 is done —
   that's expected.
2. **`api` service** → Settings:
   - Source → **Root Directory** `/backend`
   - Config-as-code → **Railway Config File** `/backend/railway.json`
   - Networking → **Generate Domain** (gives `https://<name>.up.railway.app`)
3. **`worker` service** — **+ New → GitHub Repo** → same repo → rename to `worker` → Settings:
   Root Directory `/worker`, Railway Config File `/worker/railway.json`. No domain (it has no
   HTTP port).
4. **Redis** — **+ New → Database → Add Redis**.
5. **Variables** — each service → **Variables** (or Project Settings → **Shared Variables** for
   values both need, then reference them):

   | Variable | api | worker | Value |
   |---|---|---|---|
   | `DATABASE_URL` (api) | ✓ | | Supabase → Connect → **Session pooler** string + `?sslmode=no-verify` |
   | `DATABASE_URL` (worker) | | ✓ | the same string + `?sslmode=require` |
   | `REDIS_URL` | ✓ | ✓ | `${{Redis.REDIS_URL}}` (Railway fills it in) |
   | `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET_NAME` | ✓ | ✓ | §4.2 |
   | `GROQ_API_KEY` | ✓ | ✓ | §4.4 (optional) |
   | `AUTH_DEV_BYPASS` | `false` | | real login — the API refuses to boot with `true` and a non-local `FRONTEND_ORIGIN` |
   | `PROFILES_SOURCE` | `local` | | first user to sign in becomes admin |
   | `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | ✓ | | Supabase → Settings → API |
   | `FRONTEND_ORIGIN` | ✓ | | your Vercel URL, e.g. `https://gvmc-naksha-rho.vercel.app` |
   | `TRUST_PROXY` | `1` | | Railway's edge proxy — so rate limits see the client IP |
   | `BREVO_API_KEY`, `BREVO_SENDER_EMAIL` | ✓ | | optional e-mail alerts |

   Don't set `PORT` — Railway injects it and the API listens on it.

   **Why two `DATABASE_URL`s:** both encrypt the connection, but the libraries spell it
   differently. The API's Node `pg` treats `sslmode=require` as "verify the certificate" and
   rejects Supabase's CA (`self-signed certificate in certificate chain`); the worker's
   psycopg2 doesn't know `no-verify` (`invalid sslmode value`). Use the **session pooler**
   host (`…pooler.supabase.com`), not `db.<ref>.supabase.co` — that one is IPv6-only.
6. **Migrations** — Railway does not run them. Apply them to Supabase from your PC with the
   bundled migrate container (idempotent; seeds only an empty database):

   ```bash
   docker compose run --rm --no-deps -e DATABASE_URL="<supabase session pooler url>" migrate
   ```

   Run it again whenever a new `database/migrations/*.sql` is added, **before** pushing the
   code that needs it.
7. **Deploy** — pushing to `main` redeploys only the services whose folder changed. Redeploys
   are safe mid-job: the worker's heartbeat expires and another worker re-queues its job within
   ~30 s.
8. **Point the frontend at it** — Vercel → Environment Variables → `VITE_API_URL` =
   the `api` domain → Redeploy.

### Troubleshooting

Check **service → Deployments → View logs** (Build Logs for build errors, Deploy Logs for
crashes).

| Symptom | Cause | Fix |
|---|---|---|
| Build uses Railpack/Nixpacks, "no start command", or builds the whole repo | Root Directory / config file not set | Root Directory `/backend` or `/worker`, config file `/backend/railway.json` or `/worker/railway.json`, then Redeploy |
| `Dockerfile not found` / `failed to read dockerfile` | Root Directory wrong | `dockerfilePath` is relative to the Root Directory — it must be `/backend` or `/worker` |
| "Healthcheck failed", deploy never goes live | The API crashed at start | Open Deploy Logs and match the error below |
| `AUTH_DEV_BYPASS=true but FRONTEND_ORIGIN includes …` | Login bypass left on | `AUTH_DEV_BYPASS=false` |
| `self-signed certificate in certificate chain` (api) | `sslmode=require` on the API | API `DATABASE_URL` ends with `?sslmode=no-verify` |
| `invalid sslmode value: "no-verify"` (worker) | API's flag used on the worker | Worker `DATABASE_URL` ends with `?sslmode=require` |
| `tenant/user … not found` | Wrong pooler host/user, or project paused | Copy the Session pooler string again from Supabase → Connect; resume the project |
| `ENETUNREACH` / timeout to `db.<ref>.supabase.co` | Direct DB host is IPv6-only | Use the pooler host |
| `relation "pipeline_jobs" does not exist` (or another table) | Migrations not applied to Supabase | Step 6 |
| `ENOTFOUND` / `ECONNREFUSED` `redis.railway.internal` | Redis not added/linked, or private network is IPv6-only | `REDIS_URL=${{Redis.REDIS_URL}}`; if it persists, add `socket: { family: 0 }` to `createClient()` in `backend/src/infra/queue.client.ts` |
| Worker logs nothing after `up, waiting on queue:ingest` | Normal — it is idle | Upload a source or run matching to give it work |
| Browser: "blocked by CORS policy" | `FRONTEND_ORIGIN` ≠ the site's URL | Exact URL, `https://`, no trailing slash |
| Browser calls `localhost:3000` or "mixed content" | `VITE_API_URL` unset or not rebuilt | Set it in Vercel, then **Redeploy** (it is baked in at build time) |
| Every page shows 401 | Login is on | Sign in; the first account becomes admin |
| 429 Too Many Requests for everyone | `TRUST_PROXY` missing, all users share the proxy IP | `TRUST_PROXY=1` |
| Upload / export fails | R2 keys are placeholders, or the bucket lacks CORS | Real R2 keys; R2 bucket CORS allowing `PUT`/`GET` from the Vercel URL |
| Worker build takes 5–10 min | GDAL + Tesseract + OpenCV image is ~2.4 GB | Normal, only on worker changes |

---

## 8. Step 5 — Frontend deployment (Vercel)

**This repo uses Option A.** `deploy-frontend.yml` was removed: with no `VERCEL_TOKEN` secret it
failed on every push, and alongside the Git integration it would deploy twice.

**Option A — Vercel Git integration (in use):**
1. vercel.com → Import Project → select your GitHub repo.
2. Root Directory = `frontend/`.
3. Project → Settings → Environment Variables, set:
   - `VITE_API_URL` → `https://api.yourdomain.com` (your backend's public URL)
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY`

   These are baked in at build time — redeploy after changing them. `frontend/vercel.json` sets the
   Vite framework preset and the SPA rewrite so deep links like `/officer` work.
4. Every push to `main` auto-deploys; every other branch / PR gets a preview URL.
5. To keep broken code off production, turn on GitHub branch protection for `main` and require the
   `test` workflow to pass before merging.
6. Keep `frontend/vercel.json` valid JSON — regex dots in the rewrite must be escaped as `\\.`
   (a single `\.` is an invalid JSON escape and Vercel rejects the file). Without the rewrite,
   refreshing any page other than `/` returns 404.

**Option B — GitHub Actions + Vercel token (not used):** only worth it if you need custom steps
before deploying. It needs a `VERCEL_TOKEN` (full access to the Vercel account) plus
`VERCEL_ORG_ID` / `VERCEL_PROJECT_ID` as GitHub Secrets and a workflow running
`vercel pull` → `vercel build --prod` → `vercel deploy --prebuilt --prod` (see git history for
the removed `deploy-frontend.yml`).

---

## 9. Step 6 — DNS and network hardening

1. Optional custom domains: `app.yourdomain.com` → Vercel (CNAME per Vercel's instructions);
   `api.yourdomain.com` → Railway (`api` service → Settings → Networking → Custom Domain, then
   the CNAME it shows). Without them the `*.vercel.app` / `*.up.railway.app` URLs work fine.
2. Set the `api` service's `FRONTEND_ORIGIN` (Railway Variables) to the frontend URL so CORS
   allows it.
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
[ ] Free-tier quotas checked: Supabase storage, R2 egress, Railway usage, Groq usage, GitHub Actions minutes, Vercel bandwidth
```

---

## Appendix A — Full environment variable reference

(For the GitHub Secrets vs Variables breakdown specifically, see §6.)

| Var | Where it's set | Required? | Purpose |
|---|---|---|---|
| `DATABASE_URL` | Railway vars | ✅ prod | Postgres/PostGIS DSN (Supabase in prod; blank = bundled container locally) |
| `REDIS_URL` | Railway vars | ✅ prod | Railway Redis job queue (blank = bundled container locally) |
| `AUTH_DEV_BYPASS` | Railway vars | must be `false` in prod | `true` = no-auth dev mode; **never** set `true` on a deployed env. The API refuses to boot with it on when `FRONTEND_ORIGIN` is non-local |
| `AUTH_DEV_BYPASS_ALLOW_REMOTE` | Railway vars | no | `true` overrides that boot check — only for a deliberately open demo |
| `RATE_LIMIT_PER_MIN` | Railway vars | optional (600) | per-IP request budget; 429 above it, `/api/health` exempt |
| `TRUST_PROXY` | Railway vars | ✅ on Railway (`1`) | proxy hop count (e.g. `1`) so rate limits key on the client IP, not the proxy's |
| `JOB_BACKOFF_SECONDS` | Railway vars | optional (5) | worker retry back-off base: base, 2×, 4× (cap 600 s) |
| `PROFILES_SOURCE` | Railway vars | when auth bypass off | `local` or `supabase` |
| `SUPABASE_URL` / `VITE_SUPABASE_URL` | Railway vars / Vercel | ✅ prod | Supabase project URL |
| `SUPABASE_ANON_KEY` / `VITE_SUPABASE_ANON_KEY` | Vercel | ✅ prod | client-side auth |
| `SUPABASE_SERVICE_ROLE_KEY` | Railway vars | ✅ prod | backend-only, verifies JWTs / admin ops |
| `R2_ACCOUNT_ID` / `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY` / `R2_BUCKET_NAME` | Railway vars | ✅ for uploads/export | Cloudflare R2 |
| `R2_ENDPOINT` | Railway vars | optional | override for MinIO/LocalStack instead of R2 |
| `GROQ_API_KEY` | Railway vars | optional | LLM chat/brief/alerts/schema-map |
| `VITE_API_URL` / `API_URL` | Vercel / Railway vars | ✅ prod | backend base URL the frontend calls |
| `FRONTEND_ORIGIN` | Railway vars | ✅ prod | CORS allow-list |
| `BREVO_API_KEY` / `BREVO_SENDER_EMAIL` / `BREVO_SENDER_NAME` | Railway vars | optional | transactional email alerts |

Full narrative version of this table lives in `key.md`.

## Appendix B — Known gaps / roadmap (not blockers, but good to set expectations on)

The earlier gap list here (no tests, no OGC endpoint, no geo-referencing, no CV extraction, basic
topology only) is out of date — all of those are implemented and tested; see
`plan_finish.md` §3 (traceability), §13 (test status) and §17 (current limitations). What remains:

- **Not yet verified against the real services** — the end-to-end run used `AUTH_DEV_BYPASS=true`,
  MinIO instead of R2, and no Groq key; the UI was tested against the MSW mock API. Repeat the
  §13.1 run with Supabase auth, R2 and Groq before go-live.
- **`drone` module** (`POST /api/drone/flagged-tile`) still only ingests an edge-flagged bounding
  box + confidence. Full drone imagery goes through the normal upload → extraction path instead.
- **No bundled building model** — the ONNX path activates only when a model is supplied; otherwise
  nDSM / classical extraction runs.
- **NDBI satellite alerts are seeded demo data**; no automatic Sentinel-2 pipeline yet.
- **Confidence weights are expert-set**, not yet learned from officer decisions.
- Security logging to Wazuh is done by the host's Wazuh agent tailing the container logs (Pino
  JSON); the app itself needs no Wazuh setting. Email uses Brevo; Resend is not wired.
