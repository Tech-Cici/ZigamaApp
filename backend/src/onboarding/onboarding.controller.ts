import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { Role } from '../../generated/prisma/enums.ts';
import type { AuthenticatedUser } from '../common/auth.types';
import { CurrentUser, Roles } from '../common/decorators';
import { RolesGuard } from '../common/guards';
import {
  CreateCustomerDto,
  PendingQueryDto,
  RejectCustomerDto,
} from './onboarding.dto';
import { OnboardingService } from './onboarding.service';

/**
 * Staff-only. The role split is enforced again inside the service so the rule
 * holds even if these decorators are ever changed.
 */
@Controller('admin/customers')
@UseGuards(RolesGuard)
@Roles(Role.ADMIN, Role.MANAGER)
export class OnboardingController {
  constructor(private readonly onboarding: OnboardingService) {}

  /** Opens a customer record in PENDING. Administrators only. */
  @Post()
  @Roles(Role.ADMIN)
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateCustomerDto,
  ) {
    return this.onboarding.createCustomer(user, dto);
  }

  /** The approval queue. Visible to both roles; only managers may act. */
  @Get('pending')
  pending(@Query() query: PendingQueryDto) {
    return this.onboarding.listPending(query);
  }

  @Post(':id/approve')
  @Roles(Role.MANAGER)
  approve(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.onboarding.approve(user, id);
  }

  @Post(':id/reject')
  @Roles(Role.MANAGER)
  reject(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: RejectCustomerDto,
  ) {
    return this.onboarding.reject(user, id, dto.reason);
  }
}
