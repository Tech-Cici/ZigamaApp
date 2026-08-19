import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../../generated/prisma/client.ts';
import { withDbRetry } from '../common/db-retry';

/**
 * Prisma 7 connects through a driver adapter rather than a connection URL,
 * and the driver speaks plain Postgres over TCP.
 *
 * The Prisma CLI (migrations) reads DATABASE_URL, which for a local
 * `prisma dev` server is a `prisma+postgres://` URL the driver cannot use.
 * DIRECT_DATABASE_URL holds the plain `postgres://` URL for the runtime.
 * Against a normal Postgres (Supabase, Neon, RDS, docker) both are the same
 * value and DIRECT_DATABASE_URL can be omitted.
 */
function resolveConnectionString(): string {
  const direct = process.env.DIRECT_DATABASE_URL?.trim();
  if (direct) return direct;

  const url = process.env.DATABASE_URL?.trim();
  if (!url) {
    throw new Error('DATABASE_URL is not set. Copy .env.example to .env.');
  }
  if (url.startsWith('prisma+postgres://')) {
    throw new Error(
      'DATABASE_URL uses the prisma+postgres:// scheme, which the driver ' +
        'adapter cannot open. Set DIRECT_DATABASE_URL to the plain ' +
        'postgres:// URL printed by `npx prisma dev`.',
    );
  }
  return url;
}

/**
 * Pool size.
 *
 * Note that the `connection_limit` query parameter people often put in
 * DATABASE_URL is read by Prisma's own engine and is ignored by this adapter,
 * which is backed by node-postgres — that pool is sized by `max` and defaults
 * to 10. The size has to be set here to have any effect.
 *
 * 2 is a measured default, not a guess. The local `npx prisma dev` server
 * advertises `max_connections = 100` but in practice terminates the *third*
 * simultaneous connection. A pool larger than that is actively harmful: the
 * pool opens sockets the server then kills, and hands those dead sockets to
 * whatever query asks next — which surfaces as ConnectionClosed on perfectly
 * ordinary reads.
 *
 * Queuing behind two connections is slower but correct. Raise DB_POOL_MAX to
 * 10 or more against a real Postgres, where the advertised limit is real.
 */
const DEFAULT_POOL_MAX = 2;

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(PrismaService.name);

  constructor() {
    const max = Number(process.env.DB_POOL_MAX ?? DEFAULT_POOL_MAX);
    super({
      adapter: new PrismaPg({
        connectionString: resolveConnectionString(),
        max: Number.isFinite(max) && max > 0 ? max : DEFAULT_POOL_MAX,

        // Wait for a free connection rather than failing, and recycle
        // connections often enough that a server-side close is never noticed.
        // The WASM dev server drops connections when pressed, and a pooled
        // client that was closed underneath us surfaces as ConnectionClosed on
        // whatever query happens to pick it up next.
        connectionTimeoutMillis: 10_000,
        idleTimeoutMillis: 10_000,
        maxLifetimeSeconds: 60,
        allowExitOnIdle: false,
      }),
    });
  }

  /**
   * Runs a read with the same retry policy the write paths use.
   *
   * A dropped connection is not a failure of the query — the query never ran.
   * Retrying it is always safe, and without this a burst of parallel reads
   * (which is exactly what a dashboard does: several panels loading at once)
   * returns 500s to the operator for a database that is perfectly healthy.
   *
   * `$transaction` already goes through `withDbRetry` in the services that
   * write; this is the equivalent for everything that only reads.
   */
  read<T>(label: string, work: () => Promise<T>): Promise<T> {
    return withDbRetry(`read:${label}`, work);
  }

  async onModuleInit(): Promise<void> {
    await this.$connect();
    this.logger.log('Connected to the database');
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
