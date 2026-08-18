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
  const app = await NestFactory.create(AppModule);

  app.setGlobalPrefix('api');
  app.enableCors({ origin: true, credentials: true });

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
