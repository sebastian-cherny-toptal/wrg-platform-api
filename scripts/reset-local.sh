#!/usr/bin/env sh
set -eu

case "${DATABASE_URL:-}" in
  *localhost*|*127.0.0.1*) ;;
  *)
    echo "Refusing reset: DATABASE_URL must target localhost." >&2
    exit 1
    ;;
esac

npm run db:reset
npm run db:seed
