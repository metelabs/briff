#!/bin/sh
# One image, two roles. The web role (`node server.js`) applies pending Prisma
# migrations before starting; the worker role never touches the schema.
set -e

if [ "$1" = "node" ] && [ "$2" = "server.js" ] && [ "${MIGRATE_ON_START:-true}" != "false" ]; then
  echo "entrypoint: applying database migrations"
  (cd /app/migrate && node node_modules/prisma/build/index.js migrate deploy < /dev/null)
fi

exec "$@"
