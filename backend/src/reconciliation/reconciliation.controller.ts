import { Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import { Role } from '../../generated/prisma/enums.ts';
import { Roles } from '../common/decorators';
import { RolesGuard } from '../common/guards';
import { PrismaService } from '../prisma/prisma.service';
import { ReconciliationService } from './reconciliation.service';

/**
 * Operational visibility. The sweep runs on a schedule anyway; these let staff
 * see what it found and trigger it on demand while investigating.
 */
@Controller('admin/reconciliation')
@UseGuards(RolesGuard)
@Roles(Role.ADMIN, Role.MANAGER)
export class ReconciliationController {
  constructor(
    private readonly reconciliation: ReconciliationService,
    private readonly prisma: PrismaService,
  ) {}

  @Post('run')
  @Roles(Role.ADMIN)
  run() {
    return this.reconciliation.run();
  }

  /** Callbacks that exhausted their retries and need a human. */
  @Get('dead-letters')
  async deadLetters(@Query('limit') limit?: string) {
    const take = Math.min(Number(limit ?? 50) || 50, 100);
    const rows = await this.prisma.webhookEvent.findMany({
      where: { status: 'DEAD_LETTER' },
      orderBy: { updatedAt: 'desc' },
      take,
    });
    return {
      data: rows.map((row) => ({
        id: row.id,
        provider: row.provider,
        providerEventId: row.providerEventId,
        providerRef: row.providerRef,
        attempts: row.attempts,
        lastError: row.lastError,
        createdAt: row.createdAt,
      })),
    };
  }

  /** Movements whose outcome we could not establish — money is still held. */
  @Get('unresolved')
  async unresolved() {
    const rows = await this.prisma.moneyRequest.findMany({
      where: { status: 'UNRESOLVED' },
      orderBy: { createdAt: 'desc' },
      take: 100,
      include: { account: { select: { accountNumber: true } } },
    });
    return {
      data: rows.map((row) => ({
        id: row.id,
        reference: row.reference,
        direction: row.direction,
        channel: row.channel,
        amount: row.amount.toString(),
        providerRef: row.providerRef,
        failureReason: row.failureReason,
        accountNumber: row.account.accountNumber,
        createdAt: row.createdAt,
      })),
    };
  }

  @Get('webhooks')
  async webhooks(@Query('limit') limit?: string) {
    const take = Math.min(Number(limit ?? 50) || 50, 100);
    const rows = await this.prisma.webhookEvent.findMany({
      orderBy: { createdAt: 'desc' },
      take,
    });
    return {
      data: rows.map((row) => ({
        id: row.id,
        providerEventId: row.providerEventId,
        providerRef: row.providerRef,
        status: row.status,
        attempts: row.attempts,
        signatureValid: row.signatureValid,
        lastError: row.lastError,
        createdAt: row.createdAt,
      })),
    };
  }
}
