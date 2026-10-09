import { Controller, Get, Header, Module, Param, Query } from '@nestjs/common';
import { GUIDE_KINDS } from '@ttp/shared-types';
import { z } from 'zod';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { PublicService } from './public.service';

const listQuery = z.object({
  country: z.string().trim().toUpperCase().regex(/^[A-Z]{2}$/).optional(),
  q: z.string().trim().min(1).max(100).optional(),
  kind: z.enum(GUIDE_KINDS).optional(),
});
type ListQuery = z.infer<typeof listQuery>;

/** Unauthenticated, read-only. Responses may be cached by the site for a few minutes. */
@Controller('public')
export class PublicController {
  constructor(private readonly svc: PublicService) {}

  @Get('countries')
  countries() {
    return this.svc.countries();
  }

  @Get('operators')
  operators(@Query(new ZodValidationPipe(listQuery)) q: ListQuery) {
    return this.svc.operators({ countryCode: q.country, q: q.q });
  }

  @Get('operators/:slug')
  operator(@Param('slug') slug: string) {
    return this.svc.operator(slug);
  }

  /** Read by the embeddable badge from any website, so it allows every origin and sends no cookies. */
  @Get('badge/:token')
  @Header('Access-Control-Allow-Origin', '*')
  @Header('Cache-Control', 'public, max-age=300')
  badge(@Param('token') token: string) {
    return this.svc.badge(token);
  }

  @Get('visa-guides')
  visaGuides(@Query(new ZodValidationPipe(listQuery)) q: ListQuery) {
    return this.svc.visaGuides(q.country);
  }

  @Get('visa-guides/:slug')
  visaGuide(@Param('slug') slug: string) {
    return this.svc.visaGuide(slug);
  }

  @Get('guides')
  guides(@Query(new ZodValidationPipe(listQuery)) q: ListQuery) {
    return this.svc.guides({ countryCode: q.country, kind: q.kind });
  }

  @Get('guides/:slug')
  guide(@Param('slug') slug: string) {
    return this.svc.guide(slug);
  }
}

@Module({ controllers: [PublicController], providers: [PublicService] })
export class PublicModule {}
