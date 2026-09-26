# Keys & Environment Variables

This file lists **every** environment variable / API key GVMC-Naksha can use, whether
it's required or optional, exactly how to create/obtain it, and which env file it
goes into. Read this once and you should never have to guess a variable name again.

## TL;DR — zero keys needed to run locally

```bash
cp .env.example .env
docker compose up --build
# in another shell
cd frontend && npm install && npm run dev
# open http://localhost:3001 -> /login -> pick a role -> done
```

Postgres+PostGIS, Redis, DB migrations, and auth all work out of the box with **no
external accounts**. Everything below this point is only needed to switch on a real
external service (Supabase auth, Cloudflare R2 storage, Groq AI, Google Maps).

## Which env file does what

| File | Read by | Copy from |
|---|---|---|
| `.env` (repo root) | `docker-compose.yml` — the `api`, `worker`, `migrate` services | `.env.example` |
| `frontend/.env.local` | `npm run dev` (Next.js dev server) | `frontend/.env.local.example` |

Both `.env` and `frontend/.env.local` are **gitignored** — never commit them. Only the
`*.example` files are committed. Any `NEXT_PUBLIC_*` variable the frontend needs must
be set in **both** files if you run the backend via Docker and the frontend via
`npm run dev` at the same time (the two processes don't share env files).

After editing either file, restart the corresponding process (`docker compose up
--build` / restart `npm run dev`) — Next.js and Nest only read env vars at startup.

---

## 1. Local infra (zero keys — bundled containers)

| Variable | File | Required? | What it is |
|---|---|---|---|
| `DATABASE_URL` | `.env` | No — defaults to bundled Postgres | Postgres connection string. Leave blank to use `docker-compose`'s `db` service (`postgres://gvmc:dev@db:5432/gvmcdb`). |
| `REDIS_URL` | `.env` | No — defaults to bundled Redis | Redis connection string. Leave blank to use the `redis` service (`redis://redis:6379`). |

Only set these if you want to point at an external Postgres/Redis instead of the
containers docker-compose starts for you.

## 2. Auth

| Variable | File | Required? | What it is |
|---|---|---|---|
| `AUTH_DEV_BYPASS` | `.env` | No (default `true`) | `true` = API runs open, role comes from the `/login` dev role picker (`x-dev-role` header) — no Supabase needed. Set `false` once you've filled in the Supabase keys below. |
| `PROFILES_SOURCE` | `.env` | No (default `local`) | Where role/ward_scope data lives when `AUTH_DEV_BYPASS=false`: `local` (self-provisioned in the bundled Postgres — first user to sign in becomes admin) or `supabase`. |

### Supabase Auth (only needed when `AUTH_DEV_BYPASS=false`)

**How to create:**
1. Go to [supabase.com](https://supabase.com) → sign in → **New project**.
2. Once created, go to **Project Settings → API**.
3. Copy the **Project URL** and the **anon public** key and the **service_role** key (click "reveal" — keep this one secret, it bypasses row-level security).

| Variable | File | Value |
|---|---|---|
| `SUPABASE_URL` | `.env` | Project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | `.env` | `service_role` secret key (backend only — never expose to the browser) |
| `NEXT_PUBLIC_SUPABASE_URL` | `.env` **and** `frontend/.env.local` | Same Project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | `.env` **and** `frontend/.env.local` | `anon public` key |
| `SUPABASE_ANON_KEY` | `.env` | Same `anon public` key (kept for symmetry with the server-side name; the code paths in this repo actually read `NEXT_PUBLIC_SUPABASE_ANON_KEY`) |

`NEXT_PUBLIC_*` values are safe to ship to the browser (that's what `NEXT_PUBLIC_`
means in Next.js) — only `SUPABASE_SERVICE_ROLE_KEY` must stay server-side.

## 3. Object storage — Cloudflare R2

Needed to actually upload source files and export the cadastre. Everything else
(matching, conflicts, golden-record assembly, GeoJSON build) works without it.

**How to create:**
1. Go to the [Cloudflare dashboard](https://dash.cloudflare.com) → **R2** (create an account/enable R2 if you haven't).
2. **Create bucket** → give it a name (e.g. `gvmc-naksha`).
3. Go to **R2 → Manage API Tokens → Create API Token** → give it Object Read & Write permissions scoped to your bucket. Copy the **Access Key ID** and **Secret Access Key** it shows you (shown once).
4. Your **Account ID** is shown on the R2 overview page (right sidebar) or in the dashboard URL.

| Variable | File | Value |
|---|---|---|
| `R2_ACCOUNT_ID` | `.env` | Cloudflare account ID |
| `R2_ACCESS_KEY_ID` | `.env` | API token Access Key ID |
| `R2_SECRET_ACCESS_KEY` | `.env` | API token Secret Access Key |
| `R2_BUCKET_NAME` | `.env` | Bucket name you created |
| `R2_ENDPOINT` | `.env` | Optional — only set this to point at a different S3-compatible store (MinIO / LocalStack) instead of real R2. Leave blank for R2. |

## 4. AI — Groq (optional)

Blank → chat/explain/brief/alert endpoints return templated text and schema-mapping
falls back to deterministic column-name matching. Set it to get real LLM output.

**How to create:**
1. Go to [console.groq.com/keys](https://console.groq.com/keys) → sign in.
2. **Create API Key** → copy it immediately (shown once).

| Variable | File | Value |
|---|---|---|
| `GROQ_API_KEY` | `.env` | The key from console.groq.com/keys |

## 5. Email — Brevo (optional)

Powers two notification emails: a HIGH-severity ward alert (`POST /alerts/generate`) to
officials/admins scoped to that ward, and a ticket-review outcome (`PATCH
/tickets/:id/review`) back to the officer who created the ticket. Blank `BREVO_API_KEY` or
`BREVO_SENDER_EMAIL` → both are silently skipped (logged, non-fatal) — nothing else in the
app depends on this.

**How to create:**
1. Go to [app.brevo.com](https://app.brevo.com) → sign in → **SMTP & API** (under your account menu) → **API Keys** → **Generate a new API key**.
2. Go to **Senders, Domains & Dedicated IPs → Senders** → add and verify a sender email — Brevo rejects sends from an unverified sender.

| Variable | File | Value |
|---|---|---|
| `BREVO_API_KEY` | `.env` | The key from step 1 |
| `BREVO_SENDER_EMAIL` | `.env` | The verified sender email from step 2 |
| `BREVO_SENDER_NAME` | `.env` | Display name for the sender (default `GVMC Naksha` if unset) |

## 6. Map — Google Maps JavaScript API

The frontend basemap uses Google Maps (hybrid = satellite + labels). Without it the
app still runs — the map panel just shows a hint instead of a map.

**How to create:**
1. Go to [console.cloud.google.com](https://console.cloud.google.com) → create/select a project.
2. Enable billing on the project (Google requires a billing account for Maps JS API, but it has a generous free tier).
3. **APIs & Services → Library** → search **Maps JavaScript API** → **Enable**.
4. **APIs & Services → Credentials → Create Credentials → API Key**.
5. Click the new key → under **Application restrictions**, choose **HTTP referrers** and add your dev/prod URLs (e.g. `http://localhost:3001/*`) — this key ships in the browser bundle, so restrict it.

| Variable | File | Value |
|---|---|---|
| `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` | `frontend/.env.local` (and `.env` if the API service also needs it) | The API key from step 4 |

## 7. URLs / CORS (fine as-is for local dev)

| Variable | File | Default | What it is |
|---|---|---|---|
| `NEXT_PUBLIC_API_URL` | `frontend/.env.local` | `http://localhost:3000` | Base URL the browser uses to call the API. |
| `API_URL` | `frontend/.env.local` | `http://localhost:3000` | Base URL used by Next.js server-side code (`server-api.ts`) to call the API. |
| `FRONTEND_ORIGIN` | `.env` | `http://localhost:3001` | Allowed CORS origin on the backend. |
| `PORT` | `.env` | `3000` | Port the Nest API listens on. |
| `LOG_LEVEL` | `.env` | unset | Backend log verbosity. |

Only change these for non-default ports/hosts or when deploying.

## 8. Reserved / not used yet (deploy-only placeholders)

These appear in `.env.example` but are **not read by any code in this repo today** —
they're placeholders for future deploy/notification tooling. You do not need to set
any of these to run or develop the app:

| Variable | Intended future use |
|---|---|

---

## Checklist for a "real" (non-dev) setup

- [ ] `AUTH_DEV_BYPASS=false`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` set in both `.env` and `frontend/.env.local`
- [ ] `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET_NAME` set in `.env`
- [ ] `GROQ_API_KEY` set in `.env`
- [ ] `BREVO_API_KEY`, `BREVO_SENDER_EMAIL` set in `.env` (optional — for ward-alert/ticket-review emails)
- [ ] `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` set in `frontend/.env.local`, restricted to your domain(s)
- [ ] `.env` and `frontend/.env.local` are **not** committed (`git status` should not show them — they're gitignored)
