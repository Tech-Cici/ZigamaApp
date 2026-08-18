import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { APP_GUARD } from '@nestjs/core';
import { AccountsModule } from './accounts/accounts.module';
import { AdminModule } from './admin/admin.module';
import { AuthModule } from './auth/auth.module';
import { JwtAuthGuard } from './common/guards';
import { HealthController } from './health/health.controller';
import { MovementsModule } from './movements/movements.module';
import { OnboardingModule } from './onboarding/onboarding.module';
import { PaymentsModule } from './payments/payments.module';
import { ReconciliationModule } from './reconciliation/reconciliation.module';
import { PrismaModule } from './prisma/prisma.module';
import { TransactionsModule } from './transactions/transactions.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ScheduleModule.forRoot(),
    PrismaModule,
    AuthModule,
    AccountsModule,
    TransactionsModule,
    AdminModule,
    OnboardingModule,
    MovementsModule,
    PaymentsModule,
    ReconciliationModule,
  ],
  controllers: [HealthController],
  providers: [
    // Authentication is on by default; routes opt out with @Public().
    // Defaulting to closed means a new endpoint can never be accidentally
    // exposed by forgetting to add a guard.
    { provide: APP_GUARD, useClass: JwtAuthGuard },
  ],
})
export class AppModule {}
