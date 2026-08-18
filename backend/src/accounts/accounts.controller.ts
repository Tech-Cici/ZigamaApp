import { Controller, Get, Param } from '@nestjs/common';
import type { AuthenticatedUser } from '../common/auth.types';
import { CurrentUser } from '../common/decorators';
import { AccountsService } from './accounts.service';

@Controller('accounts')
export class AccountsController {
  constructor(private readonly accounts: AccountsService) {}

  @Get('dashboard')
  dashboard(@CurrentUser() user: AuthenticatedUser) {
    return this.accounts.getDashboard(user);
  }

  @Get()
  list(@CurrentUser() user: AuthenticatedUser) {
    return this.accounts.listMyAccounts(user);
  }

  @Get('lookup/:accountNumber')
  lookup(@Param('accountNumber') accountNumber: string) {
    return this.accounts.lookupByAccountNumber(accountNumber);
  }

  @Get(':id')
  getOne(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.accounts.getAccount(user, id);
  }
}
