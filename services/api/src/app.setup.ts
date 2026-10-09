import { INestApplication } from '@nestjs/common';

/** Settings shared by the server (main.ts) and the tests' app. */
export function configureApp(app: INestApplication) {
  app.enableShutdownHooks();
  // Behind Caddy / the site's proxy on a private network: take the client address from X-Forwarded-For.
  app.getHttpAdapter().getInstance().set('trust proxy', 'loopback, uniquelocal');
}
