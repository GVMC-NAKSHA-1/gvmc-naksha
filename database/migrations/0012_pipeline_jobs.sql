-- Every queued worker job is tracked here so the UI can show live pipeline activity.
-- The API inserts the row when it enqueues; the worker moves it through running → done|failed.
CREATE TABLE pipeline_jobs (
  id          uuid PRIMARY KEY,                       -- = the jobId pushed onto the Redis queue
  job_type    text NOT NULL,
  ward_id     text,
  source_id   uuid,
  status      text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','running','done','failed')),
  attempts    int  NOT NULL DEFAULT 0,
  payload     jsonb NOT NULL DEFAULT '{}'::jsonb,
  result      jsonb,
  error       text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  started_at  timestamptz,
  finished_at timestamptz
);
CREATE INDEX pipeline_jobs_recent_idx ON pipeline_jobs (created_at DESC);
CREATE INDEX pipeline_jobs_ward_idx   ON pipeline_jobs (ward_id, created_at DESC);
