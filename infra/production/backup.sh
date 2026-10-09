#!/bin/sh
# Dumps the database once a day (and once at start) into /backups; keeps 14 days.
# Restore: see docs/DEPLOY.md, "Restoring a backup".
set -eu
while true; do
  file="/backups/ttp-$(date -u +%Y-%m-%dT%H%M).dump"
  if pg_dump --format=custom --file="$file.partial"; then
    mv "$file.partial" "$file"
    echo "Backup written: $file ($(du -h "$file" | cut -f1))"
  else
    rm -f "$file.partial"
    echo "Backup FAILED at $(date -u)" >&2
  fi
  find /backups -name 'ttp-*.dump' -mtime +14 -delete
  sleep 86400
done
