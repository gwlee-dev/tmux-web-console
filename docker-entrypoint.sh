#!/bin/sh
set -e
npx prisma migrate deploy
exec node src/server.js "$@"
