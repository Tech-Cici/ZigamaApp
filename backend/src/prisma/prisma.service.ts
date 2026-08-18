import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../../generated/prisma/client.ts';

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
 * 5 is a deliberately conservative default: a local `npx prisma dev` server
 * starts dropping connections above roughly half a dozen, and a dropped
 * connection mid-transaction is far more disruptive than queuing for a free
 * one. Raise DB_POOL_MAX against a real Postgres.
 */
const DEFAULT_POOL_MAX = 5;

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
      }),
    });
  }

  async onModuleInit(): Promise<void> {
    await this.$connect();
    this.logger.log('Connected to the database');
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
