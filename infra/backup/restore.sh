#!/usr/bin/env sh
# siteops — pg_restore script (T49).
#
# Restores a custom-format (-Fc) dump produced by `backup.sh` into the
# configured Postgres database. Uses `--clean --if-exists --no-owner
# --no-privileges` so the same command works whether the target DB is
# empty or already populated — destructive: every restored object DROPs
# what was there first.
#
# Usage:
#   restore.sh <dumpfile>
#   restore.sh latest                  # convenience: pick the newest dump
#
# Required env:
#   POSTGRES_PASSWORD
#
# Optional env (same defaults as backup.sh):
#   POSTGRES_HOST=postgres
#   POSTGRES_PORT=5432
#   POSTGRES_USER=siteops
#   POSTGRES_DB=siteops
#   BACKUP_DIR=/backups                (only used when arg is `latest`)
#
# Exit codes:
#   0  restore succeeded
#   1  pg_restore reported errors (note: pg_restore exits 0 on benign
#      warnings; we treat exit != 0 as fatal)
#   2  bad usage / required env missing
#   3  dump file not found

set -eu

if [ "${1:-}" = "" ] || [ "$1" = "-h" ] || [ "$1" = "--help" ]; then
  cat <<EOF >&2
usage: restore.sh <dumpfile|latest>

  Restores a pg_dump -Fc dump into \${POSTGRES_DB:-siteops}.

  The restore is destructive: every object in the dump DROPs its
  same-named counterpart in the target DB before being recreated.

  Pass 'latest' to pick the newest dump in \${BACKUP_DIR:-/backups}.
EOF
  exit 2
fi

: "${POSTGRES_PASSWORD:?POSTGRES_PASSWORD is required}"

POSTGRES_HOST="${POSTGRES_HOST:-postgres}"
POSTGRES_PORT="${POSTGRES_PORT:-5432}"
POSTGRES_USER="${POSTGRES_USER:-siteops}"
POSTGRES_DB="${POSTGRES_DB:-siteops}"
BACKUP_DIR="${BACKUP_DIR:-/backups}"

SOURCE="$1"
if [ "$SOURCE" = "latest" ]; then
  SOURCE="$(ls -1t "$BACKUP_DIR"/siteops-*.dump 2>/dev/null | head -n1 || true)"
  if [ -z "$SOURCE" ]; then
    echo "[restore] no dumps found in $BACKUP_DIR" >&2
    exit 3
  fi
  echo "[restore] resolved 'latest' to $SOURCE"
fi

if [ ! -f "$SOURCE" ]; then
  echo "[restore] dump not found: $SOURCE" >&2
  exit 3
fi

echo "[restore] $(date -u +%Y-%m-%dT%H:%M:%SZ) pg_restore $SOURCE -> ${POSTGRES_USER}@${POSTGRES_HOST}:${POSTGRES_PORT}/${POSTGRES_DB}"

# --clean --if-exists  : DROP each object before recreating; tolerate missing.
# --no-owner           : don't try to re-set object owners (different role).
# --no-privileges      : skip GRANT/REVOKE (also role-dependent).
# --exit-on-error      : abort on the first error rather than soldiering on
#                        and ending up with a half-restored DB.
PGPASSWORD="$POSTGRES_PASSWORD" pg_restore \
  -h "$POSTGRES_HOST" \
  -p "$POSTGRES_PORT" \
  -U "$POSTGRES_USER" \
  -d "$POSTGRES_DB" \
  --clean --if-exists \
  --no-owner --no-privileges \
  --exit-on-error \
  "$SOURCE"

echo "[restore] done — REMEMBER to restart web + worker so they reconnect cleanly"
