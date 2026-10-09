import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { checkProductionConfig, jwtSecret } from './common/config';

async function bootstrap() {
  jwtSecret(); // fail fast on missing config
  for (const w of checkProductionConfig()) console.warn(`Warning: ${w}`);
  const app = await NestFactory.create(AppModule);
  app.enableShutdownHooks();
  const port = Number(process.env.PORT ?? 3000);
  await app.listen(port);
  console.log(`API listening on http://localhost:${port}`);
}

void bootstrap();
