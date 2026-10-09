import { Global, Injectable, Logger, Module } from '@nestjs/common';

/** Cache tags the public site uses; see apps/web-content/lib/api.ts. */
export type ContentTag = 'operators' | 'guides' | 'translators';

/**
 * Tells the public site to refresh cached pages after content changes (decision B5.4: SSR/ISR
 * with on-demand revalidation), so an approval or suspension shows up within seconds.
 * Best effort: if the site is unreachable the pages still refresh on their timer.
 */
@Injectable()
export class RevalidationService {
  private readonly logger = new Logger(RevalidationService.name);

  revalidate(...tags: ContentTag[]): void {
    const url = process.env.WEB_REVALIDATE_URL;
    const secret = process.env.REVALIDATE_SECRET;
    if (!url || !secret) return;
    fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${secret}` },
      body: JSON.stringify({ tags }),
      signal: AbortSignal.timeout(3000),
    })
      .then((res) => {
        if (!res.ok) this.logger.warn(`Revalidation returned ${res.status}`);
      })
      .catch((e: Error) => this.logger.warn(`Revalidation failed: ${e.message}`));
  }
}

@Global()
@Module({ providers: [RevalidationService], exports: [RevalidationService] })
export class RevalidationModule {}
