import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import type { AuthenticatedUser } from '../common/auth.types';
import { CurrentUser } from '../common/decorators';
import {
  DepositDto,
  HistoryQueryDto,
  TransferDto,
  WithdrawDto,
} from './transactions.dto';
import { TransactionsService } from './transactions.service';

@Controller('transactions')
export class TransactionsController {
  constructor(private readonly transactions: TransactionsService) {}

  @Post('deposit')
  deposit(@CurrentUser() user: AuthenticatedUser, @Body() dto: DepositDto) {
    return this.transactions.deposit(user, dto);
  }

  @Post('withdraw')
  withdraw(@CurrentUser() user: AuthenticatedUser, @Body() dto: WithdrawDto) {
    return this.transactions.withdraw(user, dto);
  }

  @Post('transfer')
  transfer(@CurrentUser() user: AuthenticatedUser, @Body() dto: TransferDto) {
    return this.transactions.transfer(user, dto);
  }

  @Get()
  history(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: HistoryQueryDto,
  ) {
    return this.transactions.history(user, query);
  }
}
