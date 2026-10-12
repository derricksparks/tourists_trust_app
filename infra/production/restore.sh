#!/bin/sh
# Replaces ALL live data with a backup. Run from infra/production on the server:
#   ./restore.sh backups/ttp-2026-10-09T0300.dump [backups/uploads-2026-10-09T0300.tar.gz] --yes
#   ./restore.sh backups/ttp-….dump --database-only --yes     (database only; leaves the app as it is)
# Steps: drill-restores the file first (restore-check.sh), keeps a safety copy of the current
# database, stops the app, restores the database (and documents, if given), starts the app and
# waits for /health. Needs the same DOCUMENT_ENCRYPTION_KEY in .env as when the documents were saved.
set -eu
cd "$(dirname "$0")"
DUMP=""; UPLOADS=""; YES=""; DB_ONLY=""
for a in "$@"; do
  case "$a" in
    --yes) YES=1 ;;
    --database-only) DB_ONLY=1 ;;
    *.dump) DUMP="$a" ;;
    *.tar.gz) UPLOADS="$a" ;;
    *) echo "Unknown argument: $a" >&2; exit 2 ;;
  esac
done
[ -n "$DUMP" ] && [ -f "$DUMP" ] || { echo "Usage: ./restore.sh backups/ttp-<date>.dump [backups/uploads-<date>.tar.gz] [--database-only] --yes" >&2; exit 2; }
case "$(cd "$(dirname "$DUMP")" && pwd)" in */infra/production/backups) ;; *) echo "Put the file in infra/production/backups first." >&2; exit 2 ;; esac
[ -n "$YES" ] || { echo "This replaces all live data with $DUMP. Add --yes to confirm." >&2; exit 2; }
docker compose ps --status running --services 2>/dev/null | grep -qx db || { echo "The database container isn't running here. Start it with: docker compose up -d db" >&2; exit 2; }

echo "1/5 Drill-restoring $DUMP into a scratch database…"
docker compose run --rm --no-deps -T --entrypoint sh backup /restore-check.sh "/backups/$(basename "$DUMP")"

SAFETY="backups/before-restore-$(date -u +%Y-%m-%dT%H%M%S).dump"
echo "2/5 Saving the current database to $SAFETY…"
docker compose exec -T db pg_dump -U ttp --format=custom ttp > "$SAFETY"

if [ -z "$DB_ONLY" ]; then
  echo "3/5 Stopping the app…"
  docker compose stop api web bot
else
  echo "3/5 Database only: the app keeps running (expect errors from it until the restore finishes)."
fi

echo "4/5 Restoring the database…"
docker compose exec -T db dropdb -U ttp --force ttp
docker compose exec -T db createdb -U ttp ttp
docker compose exec -T db pg_restore -U ttp -d ttp --no-owner --exit-on-error < "$DUMP"
if [ -n "$UPLOADS" ] && [ -z "$DB_ONLY" ]; then
  echo "    …and the documents from $UPLOADS"
  docker compose run --rm --no-deps -T --entrypoint sh -v "$PWD/backups:/backups:ro" api \
    -c "find /data/uploads -mindepth 1 -delete && tar -xzf /backups/$(basename "$UPLOADS") -C /data/uploads"
fi

if [ -z "$DB_ONLY" ]; then
  echo "5/5 Starting the app and waiting for it to be healthy…"
  docker compose start api web bot
  i=0
  until docker compose exec -T api node -e "fetch('http://localhost:3000/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))" 2>/dev/null; do
    i=$((i + 1)); [ "$i" -ge 30 ] && { echo "The API is not healthy after the restore: docker compose logs api" >&2; exit 1; }
    sleep 2
  done
  docker compose up -d --force-recreate web >/dev/null
fi
echo "Done. Restored from $DUMP. The previous data is in $SAFETY."
