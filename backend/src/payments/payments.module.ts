import { forwardRef, Logger, Module } from '@nestjs/common';
import { MovementsModule } from '../movements/movements.module';
import { MockPaymentProvider } from './mock.provider';
import { MtnMomoProvider } from './mtn.provider';
import { PaymentsController } from './payments.controller';
import { PAYMENT_PROVIDER, type PaymentProvider } from './provider';
import { WebhooksService } from './webhooks.service';

/**
 * Binds one payment provider for the whole application.
 *
 * `mock` is the default deliberately: the real MTN adapter needs credentials
 * that have to be registered by hand, and a publicly reachable URL for
 * callbacks. Everything downstream is written against the interface, so nothing
 * else changes when you switch.
 */
const providerFactory = {
  provide: PAYMENT_PROVIDER,
  useFactory: (mock: MockPaymentProvider, mtn: MtnMomoProvider): PaymentProvider => {
    const choice = (process.env.PAYMENT_PROVIDER ?? 'mock').toLowerCase();
    const logger = new Logger('PaymentsModule');

    if (choice === 'mtn') {
      logger.log('Using the MTN Mobile Money provider');
      return mtn;
    }

    if (choice !== 'mock') {
      logger.warn(
        `Unknown PAYMENT_PROVIDER "${choice}", falling back to the mock provider`,
      );
    } else {
      logger.log('Using the mock payment provider (no credentials required)');
    }
    return mock;
  },
  inject: [MockPaymentProvider, MtnMomoProvider],
};

@Module({
  imports: [forwardRef(() => MovementsModule)],
  controllers: [PaymentsController],
  providers: [
    MockPaymentProvider,
    MtnMomoProvider,
    providerFactory,
    WebhooksService,
  ],
  exports: [PAYMENT_PROVIDER, WebhooksService],
})
export class PaymentsModule {}
