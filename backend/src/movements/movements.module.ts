import { forwardRef, Module } from '@nestjs/common';
import { PaymentsModule } from '../payments/payments.module';
import { MovementsController } from './movements.controller';
import { MovementsService } from './movements.service';

@Module({
  // The provider binding lives in PaymentsModule, which in turn needs
  // MovementsService to apply outcomes — hence the forward reference.
  imports: [forwardRef(() => PaymentsModule)],
  controllers: [MovementsController],
  providers: [MovementsService],
  exports: [MovementsService],
})
export class MovementsModule {}
