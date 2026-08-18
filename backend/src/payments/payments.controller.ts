import {
  Body,
  Controller,
  Headers,
  HttpCode,
  Post,
  Req,
} from '@nestjs/common';
import { Public } from '../common/decorators';
import { WebhooksService, type IncomingWebhook } from './webhooks.service';

interface RawBodyRequest {
  rawBody?: Buffer;
}

/**
 * Where payment providers call us back.
 *
 * Public by necessity — a provider has no bearer token. Authenticity comes from
 * the HMAC signature over the raw body instead.
 */
@Controller('payments')
export class PaymentsController {
  constructor(private readonly webhooks: WebhooksService) {}

  /**
   * Always answers 200 once the signature verifies.
   *
   * Providers read a non-2xx as "deliver it again", so returning 500 for a
   * problem on our side just multiplies the traffic. Failures are queued for
   * retry internally and the provider is told we have it.
   */
  @Public()
  @Post('webhooks/:provider')
  @HttpCode(200)
  async receive(
    @Req() request: RawBodyRequest,
    @Headers('x-signature') signature: string | undefined,
    @Body() body: Record<string, unknown>,
  ) {
    // The signature covers the exact bytes the provider sent. Re-serialising
    // the parsed object would change whitespace and key order, so the raw
    // buffer is what gets verified — see `rawBody: true` in main.ts.
    const rawBody =
      request.rawBody ?? Buffer.from(JSON.stringify(body ?? {}), 'utf8');

    const parsed: IncomingWebhook = {
      eventId: String(body?.eventId ?? ''),
      providerRef: body?.providerRef as string | undefined,
      status: body?.status as string | undefined,
      amountMinor:
        body?.amountMinor === undefined || body?.amountMinor === null
          ? undefined
          : BigInt(String(body.amountMinor)),
    };

    if (!parsed.eventId) {
      return { received: false, reason: 'eventId is required' };
    }

    const result = await this.webhooks.receive(rawBody, signature, parsed);

    return {
      received: result.accepted,
      duplicate: result.duplicate,
      ...(result.reason ? { reason: result.reason } : {}),
    };
  }
}
