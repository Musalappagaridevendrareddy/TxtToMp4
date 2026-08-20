# Local infrastructure

Postgres 16, Redis 7 and MinIO, on the ports `.env.example` already points at.

| Service  | Port   | Credentials             | Used for                        |
| -------- | ------ | ----------------------- | ------------------------------- |
| Postgres | `5432` | `explainer`/`explainer` | `jobs`, `renders` tables        |
| Redis    | `6379` | none                    | BullMQ `render` queue           |
| MinIO    | `9000` | `minioadmin`/`minioadmin` | `renders` bucket (S3 API)     |
| MinIO UI | `9001` | `minioadmin`/`minioadmin` | browsing rendered videos      |

## Bring it up

```sh
cd infra
docker compose up -d
```

`createbuckets` is a one-shot: it waits for MinIO to report healthy, creates the
`renders` bucket, makes it publicly readable and exits `0`. Seeing it in
`Exited (0)` is the success case, not a failure.

Wait for everything to be healthy:

```sh
docker compose ps
```

## Run the migrations

From the repo root, with `.env` in place:

```sh
cp .env.example .env          # then fill in ANTHROPIC_API_KEY
npm install
npm run build -w @explainer/spec
npm run build -w @explainer/api
npm run migrate -w @explainer/api
```

The runner is idempotent — run it as often as you like. It records each applied
file with a checksum in `schema_migrations`, so editing an already-applied
migration fails loudly instead of silently diverging. Add new behaviour as
`002_*.sql`, never by editing `001_init.sql`.

## Start the services

```sh
npm run start  -w @explainer/api   # HTTP API on :8080
npm run worker -w @explainer/api   # BullMQ worker (separate terminal)
```

Check it:

```sh
curl localhost:8080/healthz
```

`200` means Postgres and Redis both answered; `503` names the one that did not.

## Configuration beyond .env.example

`.env.example` covers everything required. These optional variables have working
defaults and only need setting when the default is wrong for your machine:

| Variable                 | Default      | Notes                                        |
| ------------------------ | ------------ | -------------------------------------------- |
| `PORT` / `HOST`          | `8080` / `0.0.0.0` |                                        |
| `LOG_LEVEL`              | `info`       | pino levels, plus `silent`                   |
| `PYTHON_BIN`             | `python`     | set to your venv's interpreter               |
| `PYTHON_ROOT`            | `./packages` | placed on `PYTHONPATH` for the python modules |
| `FFMPEG_BIN`             | `ffmpeg`     | used for keyframe extraction                 |
| `MAX_CRITIQUE_ITERATIONS`| `3`          | revision passes per job                      |
| `MAX_SPEC_ATTEMPTS`      | `3`          | emitter retries before the job is unrecoverable |
| `WORKER_CONCURRENCY`     | `1`          | manim and remotion are already CPU-hungry    |
| `NARRATION_TIMEOUT_MS`   | `600000`     | 10 minutes                                   |
| `MANIM_TIMEOUT_MS`       | `1800000`    | 30 minutes                                   |
| `REMOTION_TIMEOUT_MS`    | `1800000`    | 30 minutes                                   |
| `S3_PUBLIC_URL`          | `S3_ENDPOINT`| set when browsers reach MinIO on another host |
| `S3_PRESIGN_TTL_SECONDS` | `86400`      | TTL for `presignedGetUrl`                    |

A missing or malformed variable fails at boot with every problem listed at once.

## Tear it down

```sh
docker compose down            # stop, keep the data
docker compose down -v         # stop and delete the volumes (fresh start)
```

After `down -v` the migrations must be re-run — the database is empty again.

## Troubleshooting

- **`createbuckets` restarts forever** — it should not; it is `restart: "no"`.
  If it exited non-zero, MinIO was not healthy yet: `docker compose logs minio`.
- **Port already in use** — something else holds 5432/6379/9000. Change the host
  side of the mapping in `docker-compose.yml` and the matching URL in `.env`.
- **Videos upload but do not play in a browser** — the browser is reaching MinIO
  on a different hostname than the worker is. Set `S3_PUBLIC_URL`.
