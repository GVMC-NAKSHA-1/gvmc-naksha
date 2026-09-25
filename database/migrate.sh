#!/bin/sh
# Idempotent migration runner. Applies every database/migrations/*.sql that has not been
# applied yet (tracked in schema_migrations), then seeds once when the DB is empty.
set -eu

: "${DATABASE_URL:?DATABASE_URL not set}"

echo "[migrate] waiting for database ..."
i=0
until psql "$DATABASE_URL" -c 'SELECT 1' >/dev/null 2>&1; do
  i=$((i + 1))
  [ "$i" -gt 60 ] && { echo "[migrate] database not reachable"; exit 1; }
  sleep 1
done

psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -q -c \
  "CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz DEFAULT now())"

for f in /migrations/*.sql; do
  n=$(basename "$f")
  if [ "$(psql "$DATABASE_URL" -tA -c "SELECT 1 FROM schema_migrations WHERE name='$n'")" = "1" ]; then
    echo "[migrate] skip  $n"
    continue
  fi
  echo "[migrate] apply $n"
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -q -1 -f "$f"
  psql "$DATABASE_URL" -q -c "INSERT INTO schema_migrations (name) VALUES ('$n')"
done

WARDS=$(psql "$DATABASE_URL" -tA -c "SELECT count(*) FROM wards" 2>/dev/null || echo 0)
if [ "${SEED:-1}" = "1" ] && [ "${WARDS:-0}" = "0" ]; then
  echo "[migrate] seeding (fresh database)"
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -q -f /seed/seed.sql
  [ -f /seed/demo_properties.sql ] && psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -q -f /seed/demo_properties.sql
  [ -f /seed/demo_sources.sql ] && psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -q -f /seed/demo_sources.sql
else
  echo "[migrate] seed skipped (data already present or SEED=0)"
fi

# Pipeline demo layers (topology / change detection / validation) — loaded once, also on
# databases that were seeded before these features existed.
if [ "${SEED:-1}" = "1" ] && [ -f /seed/demo_pipeline.sql ] &&    [ "$(psql "$DATABASE_URL" -tA -c "SELECT count(*) FROM wards WHERE id='4'")" = "1" ] &&    [ "$(psql "$DATABASE_URL" -tA -c "SELECT count(*) FROM data_sources WHERE id IN ('33333333-3333-4333-8333-333333333333', '33333333-3333-3333-3333-333333333333')")" = "0" ]; then
  echo "[migrate] loading pipeline demo layers"
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -q -1 -f /seed/demo_pipeline.sql
fi

echo "[migrate] done"
