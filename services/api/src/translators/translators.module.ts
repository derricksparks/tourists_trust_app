import { Body, Controller, Get, HttpCode, Module, Param, ParseUUIDPipe, Post, Query, UseGuards } from '@nestjs/common';
import { AdminUser, TelegramUser } from '@prisma/client';
import {
  LANGUAGES,
  SPECIALTIES,
  TRANSLATOR_STATUSES,
  TranslationJobCreateInput,
  TranslationJobListQuery,
  TranslatorDecisionInput,
  TranslatorSignupInput,
  botJobActionSchema,
  botJobRatingSchema,
  translationJobAssignSchema,
  translationJobCancelSchema,
  translationJobCreateSchema,
  translationJobListQuerySchema,
  translatorDecisionSchema,
  translatorSignupSchema,
} from '@ttp/shared-types';
import { z } from 'zod';
import { AdminAuthGuard, AdminRoles, CurrentAdmin } from '../admin-auth/admin-auth.guard';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { BotSecretGuard, CurrentTelegramUser, TelegramAuthGuard } from '../telegram/telegram.module';
import { TranslatorsService } from './translators.service';

const directoryQuery = z.object({
  country: z.string().trim().toUpperCase().regex(/^[A-Z]{2}$/).optional(),
  specialty: z.string().refine((s) => s in SPECIALTIES).optional(),
  language: z.string().refine((l) => l in LANGUAGES).optional(),
});

@Controller('public/translators')
export class PublicTranslatorsController {
  constructor(private readonly svc: TranslatorsService) {}

  @Get()
  directory(@Query(new ZodValidationPipe(directoryQuery)) q: z.infer<typeof directoryQuery>) {
    return this.svc.directory({ countryCode: q.country, specialty: q.specialty, language: q.language });
  }

  @Get(':id')
  one(@Param('id', ParseUUIDPipe) id: string) {
    return this.svc.publicOne(id);
  }
}

/** Mini App actions, signed by Telegram (see TelegramAuthGuard). */
@Controller('public/telegram')
@UseGuards(TelegramAuthGuard)
export class TelegramTranslatorsController {
  constructor(private readonly svc: TranslatorsService) {}

  @Post('translator-signup')
  signup(@Body(new ZodValidationPipe(translatorSignupSchema)) body: TranslatorSignupInput, @CurrentTelegramUser() user: TelegramUser) {
    return this.svc.signup(user, body);
  }

  @Post('translation-jobs')
  createJob(@Body(new ZodValidationPipe(translationJobCreateSchema)) body: TranslationJobCreateInput, @CurrentTelegramUser() user: TelegramUser) {
    return this.svc.createJob(user, body);
  }
}

/** Button presses in the bot, forwarded by our bot process. */
@Controller('bot/jobs')
@UseGuards(BotSecretGuard)
export class BotJobsController {
  constructor(private readonly svc: TranslatorsService) {}

  @Post(':id/action')
  @HttpCode(200)
  action(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodValidationPipe(botJobActionSchema)) body: z.infer<typeof botJobActionSchema>) {
    return this.svc.botAction(id, body.telegramId, body.action);
  }

  @Post(':id/rate')
  @HttpCode(200)
  rate(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodValidationPipe(botJobRatingSchema)) body: z.infer<typeof botJobRatingSchema>) {
    return this.svc.rate(id, body.telegramId, body.rating);
  }
}

const statusQuery = z.object({ status: z.enum(TRANSLATOR_STATUSES).optional() });

@Controller('admin/translators')
@UseGuards(AdminAuthGuard)
export class AdminTranslatorsController {
  constructor(private readonly svc: TranslatorsService) {}

  @Get()
  list(@Query(new ZodValidationPipe(statusQuery)) q: z.infer<typeof statusQuery>) {
    return this.svc.listTranslators(q.status);
  }

  @Get(':id')
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.svc.getTranslator(id);
  }

  @Post(':id/decision')
  @HttpCode(200)
  @AdminRoles('SUPER_ADMIN', 'MODERATOR')
  decide(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(translatorDecisionSchema)) body: TranslatorDecisionInput,
    @CurrentAdmin() admin: AdminUser,
  ) {
    return this.svc.decide(id, body, admin);
  }
}

@Controller('admin/translation-jobs')
@UseGuards(AdminAuthGuard)
export class AdminTranslationJobsController {
  constructor(private readonly svc: TranslatorsService) {}

  @Get()
  list(@Query(new ZodValidationPipe(translationJobListQuerySchema)) q: TranslationJobListQuery) {
    return this.svc.listJobs(q);
  }

  @Post(':id/assign')
  @HttpCode(200)
  @AdminRoles('SUPER_ADMIN', 'MODERATOR')
  assign(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodValidationPipe(translationJobAssignSchema)) body: { translatorId: string }, @CurrentAdmin() admin: AdminUser) {
    return this.svc.assign(id, body.translatorId, admin);
  }

  @Post(':id/cancel')
  @HttpCode(200)
  @AdminRoles('SUPER_ADMIN', 'MODERATOR')
  cancel(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodValidationPipe(translationJobCancelSchema)) body: { reason: string }, @CurrentAdmin() admin: AdminUser) {
    return this.svc.cancel(id, body.reason, admin);
  }
}

@Module({
  controllers: [PublicTranslatorsController, TelegramTranslatorsController, BotJobsController, AdminTranslatorsController, AdminTranslationJobsController],
  providers: [TranslatorsService],
})
export class TranslatorsModule {}
