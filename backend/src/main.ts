import 'reflect-metadata';
import { Logger, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

// Safety net: `JSON.stringify` throws on BigInt. Money is normally converted to
// a string by the serializers, but a missed field should not produce a 500.
(BigInt.prototype as unknown as { toJSON: () => string }).toJSON = function () {
  return this.toString();
};

async function bootstrap(): Promise<void> {
  // rawBody keeps the exact bytes of each request available. Webhook
  // signatures are HMACs over the raw payload, and re-serialising the parsed
  // JSON would change key order and whitespace, breaking every signature.
  const app = await NestFactory.create(AppModule, { rawBody: true });

  app.setGlobalPrefix('api');

  // The mobile app sends no Origin header, so it is unaffected either way. The
  // staff console is a browser app and is what this protects: reflecting any
  // origin lets a page on another site call the API with a signed-in operator's
  // credentials. Set CORS_ORIGINS to a comma-separated allow-list in
  // production; development stays permissive so a LAN IP or tunnel just works.
  const allowed = process.env.CORS_ORIGINS?.split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);

  app.enableCors({
    origin: allowed?.length ? allowed : true,
    credentials: true,
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: false },
    }),
  );

  const port = Number(process.env.PORT ?? 3000);

  // Bind to all interfaces so a phone on the same Wi-Fi can reach the API;
  // localhost alone is unreachable from a physical device.
  await app.listen(port, '0.0.0.0');

  Logger.log(`API listening on http://0.0.0.0:${port}/api`, 'Bootstrap');
}

void bootstrap();
