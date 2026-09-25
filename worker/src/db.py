import os, json
from contextlib import contextmanager
import psycopg2, psycopg2.extras

@contextmanager
def cursor():
    conn = psycopg2.connect(os.environ["DATABASE_URL"], cursor_factory=psycopg2.extras.RealDictCursor)
    try:
        with conn, conn.cursor() as cur:
            yield cur
    finally:
        conn.close()

def ward_lock(cur, ward):
    """Serialise ward-level jobs (match / conflicts / assemble / validate) across workers until the
    transaction ends, so two workers never rewrite the same ward's matches at once."""
    cur.execute("SELECT pg_advisory_xact_lock(hashtext(%s))", (f"ward:{ward}",))

def get_data_source(source_id):
    with cursor() as cur:
        cur.execute("SELECT * FROM data_sources WHERE id = %s", (source_id,))
        return cur.fetchone()

def insert_source_features(source_id, rows, page_size=1000):
    """rows: [(geojson geometry, properties, was_invalid)] — one connection and one transaction."""
    with cursor() as cur:
        psycopg2.extras.execute_values(
            cur,
            "INSERT INTO source_features (source_id, geom, properties, was_invalid) VALUES %s",
            [(source_id, json.dumps(g), json.dumps(p, default=str), bool(w)) for g, p, w in rows],
            template="(%s, ST_SetSRID(ST_GeomFromGeoJSON(%s), 4326), %s, %s)",
            page_size=page_size)

def set_status(source_id, status, error=None):
    with cursor() as cur:
        cur.execute("UPDATE data_sources SET status=%s, error=%s WHERE id=%s", (status, error, source_id))

def update_source_metadata(source_id, patch: dict):
    with cursor() as cur:
        cur.execute("UPDATE data_sources SET metadata = metadata || %s::jsonb WHERE id=%s",
                    (json.dumps(patch), source_id))
