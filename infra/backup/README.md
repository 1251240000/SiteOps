# `infra/backup/` — Postgres backup & restore

Daily `pg_dump -Fc` backups for the production Postgres in
`infra/docker-compose.yml`, plus a matching restore script and a CI drill
that exercises the round trip on every push to `main`.

Operational runbook (manual backup, restore from a specific dump, etc.)
lives in [`docs/12-backup-restore.md`](../../docs/12-backup-restore.md).
This README focuses on the file layout.

## Files

| File            | Role                                                                                                                                          |
| --------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `backup.sh`     | `pg_dump -Fc` to `$BACKUP_DIR/siteops-<UTC-timestamp>.dump`; prunes files older than `$KEEP_DAYS` (default 14). Atomic via `.partial` swap.   |
| `restore.sh`    | `pg_restore --clean --if-exists --no-owner --no-privileges --exit-on-error` from a given dump (or `latest`).                                  |
| `entrypoint.sh` | Sidecar entrypoint: bakes env into a busybox crontab and launches `crond -f`. Optional `BACKUP_RUN_ON_BOOT=true` runs one backup immediately. |
| `README.md`     | this file                                                                                                                                     |

## How the sidecar works

`infra/docker-compose.yml` defines a `postgres-backup` service under the
optional `backup` profile:

```bash
docker compose -f infra/docker-compose.yml --profile backup up -d postgres-backup
```

The service:

- runs the `postgres:16-alpine` image (same as the DB itself, so
  `pg_dump` / `pg_restore` versions match)
- mounts the three scripts read-only into `/usr/local/bin/`
- writes dumps into the `pg-backup` named volume mounted at `/backups`
- reads `POSTGRES_*` + `BACKUP_KEEP_DAYS` from `.env`
- runs `entrypoint.sh`, which schedules `backup.sh` at `BACKUP_CRON`
  (default `0 2 * * *` UTC) and tails `/var/log/backup.log` to stdout

To force an out-of-band backup:

```bash
docker compose -f infra/docker-compose.yml exec postgres-backup /usr/local/bin/backup.sh
```

To restore the newest dump back into the running DB:

```bash
docker compose -f infra/docker-compose.yml exec postgres-backup \
  /usr/local/bin/restore.sh latest
docker compose -f infra/docker-compose.yml restart web worker
```

Restart `web` + `worker` after every restore — they cache prepared
statements that won't survive a `--clean` cycle, and BullMQ workers may
hold stale job rows.

## Env knobs

All of these are optional; defaults are sensible for the compose stack.

| Var                  | Default               | Notes                                              |
| -------------------- | --------------------- | -------------------------------------------------- |
| `POSTGRES_HOST`      | `postgres`            | DB hostname inside `siteops-net`                   |
| `POSTGRES_PORT`      | `5432`                |                                                    |
| `POSTGRES_USER`      | `siteops`             |                                                    |
| `POSTGRES_DB`        | `siteops`             |                                                    |
| `POSTGRES_PASSWORD`  | _(required)_          | inherited from the main stack's `.env`             |
| `BACKUP_DIR`         | `/backups`            | matches the `pg-backup` volume mount               |
| `KEEP_DAYS`          | `14`                  | overrides via `BACKUP_KEEP_DAYS` in `.env`         |
| `BACKUP_CRON`        | `0 2 * * *`           | five-field busybox crontab expression              |
| `BACKUP_RUN_ON_BOOT` | `false`               | set to `true` to run one backup at container start |
| `BACKUP_LOG_FILE`    | `/var/log/backup.log` | tailed to stdout for `docker logs`                 |

## CI drill

`.github/workflows/db-backup-restore.yml` runs on every push to `main`,
nightly, and on `workflow_dispatch`. It:

1. boots a PG 16 service container,
2. applies migrations + seeds the admin user,
3. inserts a deterministic set of sentinel rows,
4. runs `backup.sh` inside `postgres:16-alpine`,
5. wipes the `public` schema,
6. runs `restore.sh` against the resulting dump,
7. asserts the sentinel rows came back and the dump pruner keeps newer
   files when `KEEP_DAYS=0` is passed.

If migrations ever produce a schema that pg_dump/pg_restore can't round
trip cleanly, this workflow goes red — which is the whole point.
