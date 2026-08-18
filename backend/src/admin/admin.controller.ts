import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Query,
  UseGuards,
} from '@nestjs/common';
import { Role } from '../../generated/prisma/enums.ts';
import type { AuthenticatedUser } from '../common/auth.types';
import { CurrentUser, Roles } from '../common/decorators';
import { RolesGuard } from '../common/guards';
import {
  ListTransactionsQueryDto,
  ListUsersQueryDto,
  UpdateAccountStatusDto,
  UpdateUserStatusDto,
} from './admin.dto';
import { AdminService } from './admin.service';

/**
 * Managers get read-only oversight; admins can additionally change account and
 * user status. Every route here is staff-only.
 */
@Controller('admin')
@UseGuards(RolesGuard)
@Roles(Role.ADMIN, Role.MANAGER)
export class AdminController {
  constructor(private readonly admin: AdminService) {}

  @Get('stats')
  stats() {
    return this.admin.getStats();
  }

  @Get('users')
  listUsers(@Query() query: ListUsersQueryDto) {
    return this.admin.listUsers(query);
  }

  @Get('users/:id')
  getUser(@Param('id') id: string) {
    return this.admin.getUser(id);
  }

  @Get('transactions')
  listTransactions(@Query() query: ListTransactionsQueryDto) {
    return this.admin.listTransactions(query);
  }

  @Get('audit-logs')
  @Roles(Role.ADMIN)
  auditLogs(@Query('page') page?: string, @Query('limit') limit?: string) {
    return this.admin.listAuditLogs(
      page ? Number(page) : 1,
      limit ? Number(limit) : 50,
    );
  }

  @Patch('accounts/:id/status')
  @Roles(Role.ADMIN)
  setAccountStatus(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: UpdateAccountStatusDto,
  ) {
    return this.admin.setAccountStatus(user, id, dto.status);
  }

  @Patch('users/:id/status')
  @Roles(Role.ADMIN)
  setUserStatus(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: UpdateUserStatusDto,
  ) {
    return this.admin.setUserActive(user, id, dto.isActive);
  }
}
