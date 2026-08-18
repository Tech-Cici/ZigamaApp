import { Body, Controller, Get, Ip, Post } from '@nestjs/common';
import type { AuthenticatedUser } from '../common/auth.types';
import { CurrentUser, Public } from '../common/decorators';
import { CustomerLoginDto, StaffLoginDto } from './auth.dto';
import { AuthService } from './auth.service';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Public()
  @Post('login')
  loginCustomer(@Body() dto: CustomerLoginDto, @Ip() ip: string) {
    return this.authService.loginCustomer(dto.accountNumber, dto.pin, ip);
  }

  @Public()
  @Post('staff/login')
  loginStaff(@Body() dto: StaffLoginDto, @Ip() ip: string) {
    return this.authService.loginStaff(dto.email, dto.password, ip);
  }

  /** Lets the app restore a session on launch and confirm the token is valid. */
  @Get('me')
  me(@CurrentUser() user: AuthenticatedUser) {
    return user;
  }
}
