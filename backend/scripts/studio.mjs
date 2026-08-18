import 'dotenv/config';
import { spawn } from 'node:child_process';

/**
 * Launches Prisma Studio against the direct Postgres connection.
 *
 * Studio in Prisma 7 refuses `prisma+postgres://` URLs, which is exactly what
 * DATABASE_URL holds when you run a local `prisma dev` server. The plain
 * `postgres://` form already lives in DIRECT_DATABASE_URL for the driver
 * adapter, so reuse it here rather than making you edit .env to browse data.
 */
const url = process.env.DIRECT_DATABASE_URL ?? process.env.DATABASE_URL;

if (!url) {
  console.error('Set DIRECT_DATABASE_URL (or DATABASE_URL) in backend/.env');
  process.exit(1);
}

if (url.startsWith('prisma+postgres://') || url.startsWith('prisma://')) {
  console.error(
    'Prisma Studio needs a direct postgres:// URL, but only an Accelerate-style\n' +
      'URL was found. Start the local database with `npm run db:dev` and copy the\n' +
      'connection string it prints into DIRECT_DATABASE_URL in backend/.env.',
  );
  process.exit(1);
}

const child = spawn('npx', ['prisma', 'studio'], {
  stdio: 'inherit',
  env: { ...process.env, DATABASE_URL: url },
});

child.on('exit', (code) => process.exit(code ?? 0));
