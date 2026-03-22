#!/bin/sh
set -e

echo "Running database migrations..."
# Enable PostGIS extension
PGPASSWORD=printbid psql -h db -U printbid -d printbid -c "CREATE EXTENSION IF NOT EXISTS postgis;" 2>/dev/null || true
npx prisma db push --skip-generate --accept-data-loss

echo "Starting server..."
exec node dist/index.js
