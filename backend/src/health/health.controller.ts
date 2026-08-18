import { Controller, Get } from '@nestjs/common';
import { Public } from '../common/decorators';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Liveness endpoint.
 *
 * Two jobs beyond the obvious one: hosting platforms poll it to decide whether
 * a deploy succeeded, and it is the cheapest way to wake a free-tier instance
 * that has been idled out before someone tries to sign in.
 *
 * It deliberately touches the database — an API that answers but cannot reach
 * Postgres is not healthy, and reporting it as such would hide the real fault.
 */
@Controller('health')
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  @Public()
  @Get()
  async check() {
    const startedAt = Date.now();

    try {
      await this.prisma.$queryRaw`SELECT 1`;
      return {
        status: 'ok',
        database: 'reachable',
        latencyMs: Date.now() - startedAt,
        uptimeSeconds: Math.round(process.uptime()),
      };
    } catch (error) {
      return {
        status: 'degraded',
        database: 'unreachable',
        latencyMs: Date.now() - startedAt,
        uptimeSeconds: Math.round(process.uptime()),
        error: (error as Error).message,
      };
    }
  }
}
