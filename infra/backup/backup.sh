#!/usr/bin/env sh
# siteops — pg_dump backup script (T49).
#
# Writes a custom-format (-Fc) dump of the configured Postgres database
# to ${BACKUP_DIR:-/backups}/siteops-<UTC-timestamp>.dump and prunes any
# dumps older than ${KEEP_DAYS:-14} days.
#
# Required env:
#   POSTGRES_PASSWORD          (no default; -h/-U/-d/-p all have sane defaults)
#
# Optional env:
#   POSTGRES_HOST=postgres
#   POSTGRES_PORT=5432
#   POSTGRES_USER=siteops
#   POSTGRES_DB=siteops
#   BACKUP_DIR=/backups
#   KEEP_DAYS=14
#
# Designed to be run either:
#   - inside the `postgres-backup` sidecar (via busybox crond), or
#   - ad-hoc on the host: `docker compose exec postgres-backup /usr/local/bin/backup.sh`
#
# Exit codes:
#   0  success
#   1  pg_dump failed (no dump written)
#   2  required env missing

set -eu

: "${POSTGRES_PASSWORD:?POSTGRES_PASSWORD is required}"

POSTGRES_HOST="${POSTGRES_HOST:-postgres}"
POSTGRES_PORT="${POSTGRES_PORT:-5432}"
POSTGRES_USER="${POSTGRES_USER:-siteops}"
POSTGRES_DB="${POSTGRES_DB:-siteops}"
BACKUP_DIR="${BACKUP_DIR:-/backups}"
KEEP_DAYS="${KEEP_DAYS:-14}"

mkdir -p "$BACKUP_DIR"

TIMESTAMP="$(date -u +%Y%m%dT%H%M%SZ)"
TARGET="${BACKUP_DIR}/siteops-${TIMESTAMP}.dump"
TARGET_TMP="${TARGET}.partial"

echo "[backup] $(date -u +%Y-%m-%dT%H:%M:%SZ) pg_dump ${POSTGRES_USER}@${POSTGRES_HOST}:${POSTGRES_PORT}/${POSTGRES_DB} -> ${TARGET}"

# Write to a .partial file first, then rename atomically once pg_dump
# succeeds. That way a half-written dump never masquerades as a real one
# if the container is OOM-killed mid-backup.
if ! PGPASSWORD="$POSTGRES_PASSWORD" pg_dump \
      -h "$POSTGRES_HOST" \
      -p "$POSTGRES_PORT" \
      -U "$POSTGRES_USER" \
      -d "$POSTGRES_DB" \
      --format=custom \
      --no-owner \
      --no-privileges \
      --file="$TARGET_TMP"; then
  echo "[backup] pg_dump failed; leaving partial at $TARGET_TMP for inspection" >&2
  exit 1
fi

mv -- "$TARGET_TMP" "$TARGET"

SIZE_BYTES="$(wc -c < "$TARGET" | tr -d ' ')"
echo "[backup] wrote ${TARGET} (${SIZE_BYTES} bytes)"

# Retention. -mtime +N means "last modified more than N*24h ago" — matches
# the spec ("KEEP_DAYS=14 -> drop anything older than 14 days").
if [ "$KEEP_DAYS" -gt 0 ] 2>/dev/null; then
  PRUNED=0
  # POSIX-find friendly loop (no -delete on busybox builds without it).
  find "$BACKUP_DIR" -maxdepth 1 -type f -name 'siteops-*.dump' -mtime "+${KEEP_DAYS}" -print | while IFS= read -r old; do
    rm -f -- "$old"
    echo "[backup] pruned $old (older than ${KEEP_DAYS}d)"
    PRUNED=$((PRUNED + 1))
  done
fi

echo "[backup] done"
