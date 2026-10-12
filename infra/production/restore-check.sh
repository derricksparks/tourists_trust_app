#!/bin/sh
# Restore drill: restores a backup into a scratch database, checks it, then deletes the scratch
# database. Live data is never touched. Run it monthly, and before any real restore:
#   docker compose run --rm --no-deps --entrypoint sh backup /restore-check.sh            (newest backup)
#   docker compose run --rm --no-deps --entrypoint sh backup /restore-check.sh /backups/ttp-2026-10-09T0300.dump
# Uses the PG* connection settings of the backup service. Exits non-zero if anything is wrong.
set -eu
DIR="${BACKUP_DIR:-/backups}"
FILE="${1:-$(ls -1t "$DIR"/ttp-*.dump 2>/dev/null | head -n 1)}"
CHECK_DB="${CHECK_DB:-ttp_restore_check}"
LIVE_DB="${PGDATABASE:-ttp}"
if [ -z "$FILE" ] || [ ! -f "$FILE" ]; then
  echo "FAIL: no backup file found (looked in $DIR)" >&2
  exit 1
fi
echo "Checking $FILE ($(du -h "$FILE" | cut -f1))"
pg_restore --list "$FILE" > /dev/null || { echo "FAIL: not a readable pg_dump archive" >&2; exit 1; }

dropdb --if-exists "$CHECK_DB"
createdb "$CHECK_DB"
trap 'dropdb --if-exists "$CHECK_DB" >/dev/null 2>&1 || true' EXIT
if ! pg_restore --no-owner --exit-on-error -d "$CHECK_DB" "$FILE"; then
  echo "FAIL: the backup did not restore cleanly" >&2
  exit 1
fi

q() { psql -d "$1" -tAc "$2"; }
tables=$(q "$CHECK_DB" "SELECT count(*) FROM pg_tables WHERE schemaname = 'public'")
migrations=$(q "$CHECK_DB" "SELECT count(*) FROM _prisma_migrations WHERE finished_at IS NOT NULL")
live_migrations=$(q "$LIVE_DB" "SELECT count(*) FROM _prisma_migrations WHERE finished_at IS NOT NULL" 2>/dev/null || echo "?")
if [ "$tables" -lt 10 ] || [ "$migrations" -lt 1 ]; then
  echo "FAIL: restored database looks empty ($tables tables, $migrations migrations)" >&2
  exit 1
fi
echo "Restored: $tables tables, $migrations migrations (live database has $live_migrations)."
for t in admin_users operators accounts dmcs packages quote_requests inquiries reviews operator_documents; do
  echo "  $t: $(q "$CHECK_DB" "SELECT count(*) FROM \"$t\"") rows"
done
if [ "$live_migrations" != "?" ] && [ "$migrations" != "$live_migrations" ]; then
  echo "NOTE: the backup is from an older version; the API applies the missing migrations when it starts after a restore."
fi
echo "PASS: restore check passed. Scratch database removed."
