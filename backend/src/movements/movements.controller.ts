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
  DecideMovementDto,
  DeclareBranchDepositDto,
  MomoDepositDto,
  MomoWithdrawalDto,
  MovementQueryDto,
  RejectMovementDto,
  RequestBranchWithdrawalDto,
} from './movements.dto';
import { MovementsService } from './movements.service';

/**
 * Cash movements that need confirming.
 *
 * Customers raise requests; managers decide them. Neither the raising nor the
 * deciding moves money on its own — see MovementsService.settle.
 */
@Controller('movements')
@UseGuards(RolesGuard)
export class MovementsController {
  constructor(private readonly movements: MovementsService) {}

  @Post('deposits/branch')
  @Roles(Role.CUSTOMER)
  declareDeposit(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: DeclareBranchDepositDto,
  ) {
    return this.movements.declareBranchDeposit(user, dto);
  }

  @Post('withdrawals/branch')
  @Roles(Role.CUSTOMER)
  requestWithdrawal(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: RequestBranchWithdrawalDto,
  ) {
    return this.movements.requestBranchWithdrawal(user, dto);
  }

  /** Mobile money in: the provider asks the customer to approve on their phone. */
  @Post('deposits/momo')
  @Roles(Role.CUSTOMER)
  momoDeposit(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: MomoDepositDto,
  ) {
    return this.movements.requestMomoDeposit(user, dto);
  }

  /** Mobile money out, to the number registered on the customer's profile. */
  @Post('withdrawals/momo')
  @Roles(Role.CUSTOMER)
  momoWithdrawal(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: MomoWithdrawalDto,
  ) {
    return this.movements.requestMomoWithdrawal(user, dto);
  }

  /** The customer's own requests and their current state. */
  @Get('mine')
  @Roles(Role.CUSTOMER)
  mine(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: MovementQueryDto,
  ) {
    return this.movements.listMine(user, query);
  }

  @Post(':id/cancel')
  @Roles(Role.CUSTOMER)
  cancel(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.movements.cancel(user, id);
  }

  /** Staff queue. Both roles can look; only a manager can act. */
  @Get('pending')
  @Roles(Role.MANAGER, Role.ADMIN)
  pending(@Query() query: MovementQueryDto) {
    return this.movements.listPending(query);
  }

  @Post(':id/approve')
  @Roles(Role.MANAGER)
  approve(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: DecideMovementDto,
  ) {
    return this.movements.approve(user, id, dto.note);
  }

  @Post(':id/reject')
  @Roles(Role.MANAGER)
  reject(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: RejectMovementDto,
  ) {
    return this.movements.reject(user, id, dto.reason);
  }
}
