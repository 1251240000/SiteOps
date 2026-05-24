#!/usr/bin/env sh
# siteops — postgres-backup sidecar entrypoint (T49).
#
# Sets up a busybox cron schedule that runs /usr/local/bin/backup.sh at
# the configured cadence (default: 02:00 UTC daily). Sidecar runs as
# `image: postgres:16-alpine`, which ships busybox `crond` plus the
# Postgres 16 client tools needed by backup.sh / restore.sh.
#
# Optional env:
#   BACKUP_CRON="0 2 * * *"        # busybox crond schedule expression
#   BACKUP_RUN_ON_BOOT=false       # set to "true" to run one backup at
#                                  # container start (handy for smoke tests)
#   …plus everything backup.sh consumes (POSTGRES_*, BACKUP_DIR, KEEP_DAYS).

set -eu

CRON_SCHEDULE="${BACKUP_CRON:-0 2 * * *}"
BACKUP_DIR="${BACKUP_DIR:-/backups}"
LOG_FILE="${BACKUP_LOG_FILE:-/var/log/backup.log}"

mkdir -p "$BACKUP_DIR" "$(dirname "$LOG_FILE")"
touch "$LOG_FILE"

if [ "${BACKUP_RUN_ON_BOOT:-false}" = "true" ]; then
  echo "[entrypoint] BACKUP_RUN_ON_BOOT=true → running an initial backup"
  /usr/local/bin/backup.sh >>"$LOG_FILE" 2>&1 || \
    echo "[entrypoint] initial backup failed; continuing into cron loop" >&2
fi

# busybox crond launches jobs with a near-empty environment. Bake every
# var backup.sh needs straight into the crontab so the schedule entry
# can find them — POSIX cron envvar syntax at the top of the file.
mkdir -p /etc/crontabs
{
  echo "POSTGRES_HOST=${POSTGRES_HOST:-postgres}"
  echo "POSTGRES_PORT=${POSTGRES_PORT:-5432}"
  echo "POSTGRES_USER=${POSTGRES_USER:-siteops}"
  echo "POSTGRES_DB=${POSTGRES_DB:-siteops}"
  echo "POSTGRES_PASSWORD=${POSTGRES_PASSWORD}"
  echo "BACKUP_DIR=${BACKUP_DIR}"
  echo "KEEP_DAYS=${KEEP_DAYS:-14}"
  echo "PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"
  echo ""
  echo "${CRON_SCHEDULE} /usr/local/bin/backup.sh >>${LOG_FILE} 2>&1"
} > /etc/crontabs/root

echo "[entrypoint] cron schedule: ${CRON_SCHEDULE}"
echo "[entrypoint] target: ${POSTGRES_USER:-siteops}@${POSTGRES_HOST:-postgres}/${POSTGRES_DB:-siteops}"
echo "[entrypoint] backup dir: ${BACKUP_DIR} (keep ${KEEP_DAYS:-14}d)"

# Mirror the rolling log to stdout so `docker logs postgres-backup`
# shows what cron ran. -F follows the file across rotations.
tail -F "$LOG_FILE" &

# -f foreground, -l 8 ≈ "info" verbosity.
exec crond -f -l 8
