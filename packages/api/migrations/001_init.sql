-- Explainer engine core schema.

CREATE TABLE IF NOT EXISTS jobs (
  id          uuid PRIMARY KEY,
  question    text        NOT NULL,
  status      text        NOT NULL DEFAULT 'queued',
  spec        jsonb,
  plan        text,
  error       text,
  video_url   text,
  spec_hash   text,
  iterations  int         NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS renders (
  id            uuid PRIMARY KEY,
  job_id        uuid        NOT NULL REFERENCES jobs (id) ON DELETE CASCADE,
  spec_hash     text,
  stage         text        NOT NULL,
  artifact_path text,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS jobs_status_idx ON jobs (status);
CREATE INDEX IF NOT EXISTS renders_spec_hash_idx ON renders (spec_hash);

-- Cache lookups: identical question -> finished video, and identical spec ->
-- finished video. Partial so the index only carries rows a cache hit can use.
CREATE INDEX IF NOT EXISTS jobs_question_cache_idx
  ON jobs (question, created_at DESC)
  WHERE status = 'completed' AND video_url IS NOT NULL;

CREATE INDEX IF NOT EXISTS jobs_spec_hash_cache_idx
  ON jobs (spec_hash, created_at DESC)
  WHERE status = 'completed' AND video_url IS NOT NULL;

CREATE INDEX IF NOT EXISTS jobs_created_at_idx ON jobs (created_at DESC);
CREATE INDEX IF NOT EXISTS renders_job_id_idx ON renders (job_id, created_at);
