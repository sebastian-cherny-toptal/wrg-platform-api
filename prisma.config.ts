import 'dotenv/config';
import { defineConfig } from 'prisma/config';

// Client generation does not need a live database. Runtime and migration
// commands receive the real DATABASE_URL from Railway.
const databaseUrl = process.env.DATABASE_URL
  ?? 'postgresql://build:build@127.0.0.1:5432/build';

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
    seed: 'tsx prisma/seed.ts',
  },
  datasource: {
    url: databaseUrl,
  },
});
