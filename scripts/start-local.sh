#!/usr/bin/env sh
set -eu

if [ ! -f .env ]; then
  cp .env.example .env
fi
docker compose up -d postgres redis minio
npm run db:deploy
npm run db:seed
exec npm run start:dev
