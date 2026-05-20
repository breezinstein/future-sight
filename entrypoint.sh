#!/bin/sh
# Future Sight entrypoint — fix data-volume permissions then drop privileges.
# Modelled on the homedash entrypoint pattern.

set -e

# If the data directory is mounted (named volume / bind mount), the host UID
# may not match our fsuser UID. Re-apply ownership so SQLite can write.
if [ -d /app/data ]; then
  chown -R fsuser:fsuser /app/data || true
fi

# Hand off to the actual command as fsuser.
exec su-exec fsuser:fsuser "$@"