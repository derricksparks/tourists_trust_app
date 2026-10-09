import { ConflictException, ForbiddenException, HttpException, HttpStatus, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { AdminUser, Prisma, TelegramUser, TranslationJobStatus, Translator, TranslatorVerificationStatus } from '@prisma/client';
import {
  LANGUAGES,
  PublicTranslator,
  TRANSLATOR_TRANSITIONS,
  TranslationJobCreateInput,
  TranslationJobListQuery,
  TranslatorDecisionInput,
  TranslatorSignupInput,
} from '@ttp/shared-types';
import { activeCountry } from '../common/countries';
import { PrismaService } from '../common/prisma.service';
import { RevalidationService } from '../common/revalidation.service';
import { TelegramBotApi } from '../telegram/bot-api';

const html = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const lang = (code: string) => LANGUAGES[code] ?? code;
/** A clickable contact in a Telegram HTML message: @username, or a mention link by user id. */
const contactOf = (u: Pick<TelegramUser, 'username' | 'firstName' | 'telegramId'>) =>
  u.username ? `@${html(u.username)}` : `<a href="tg://user?id=${u.telegramId}">${html(u.firstName ?? 'контакт')}</a>`;

const MAX_JOBS_PER_HOUR = 3;

const jobInclude = {
  translator: { select: { id: true, name: true, telegramUser: { select: { username: true } } } },
  requesterTelegramUser: { select: { username: true, firstName: true, lastName: true } },
  requesterOperator: { select: { id: true, name: true } },
  requesterDmc: { select: { id: true, name: true } },
} satisfies Prisma.TranslationJobInclude;

/**
 * Translator network (TR-1…TR-4). Travellers pick a verified translator in the Mini App; the offer
 * goes to the translator in the bot; accepting exchanges contacts (the "chat handoff" for live
 * interpretation); finishing asks the traveller for a 1–5 rating, which feeds the directory.
 */
@Injectable()
export class TranslatorsService {
  private readonly logger = new Logger(TranslatorsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly bot: TelegramBotApi,
    private readonly revalidation: RevalidationService,
  ) {}

  // ── Public ────────────────────────────────────────────────────────────────

  async directory(params: { countryCode?: string; specialty?: string; language?: string }): Promise<PublicTranslator[]> {
    const rows = await this.prisma.translator.findMany({
      where: {
        verificationStatus: 'VERIFIED',
        specialtyCountryCode: params.countryCode,
        ...(params.specialty && { specialties: { has: params.specialty } }),
        ...(params.language && { languages: { has: params.language } }),
      },
      orderBy: [{ rating: { sort: 'desc', nulls: 'last' } }, { jobsCompleted: 'desc' }, { name: 'asc' }],
    });
    return rows.map(toPublic);
  }

  async publicOne(id: string): Promise<PublicTranslator> {
    const t = await this.prisma.translator.findFirst({ where: { id, verificationStatus: 'VERIFIED' } });
    if (!t) throw new NotFoundException('Переводчик не найден');
    return toPublic(t);
  }


  async signup(user: TelegramUser, input: TranslatorSignupInput) {
    await activeCountry(this.prisma, input.specialtyCountryCode);
    const existing = await this.prisma.translator.findUnique({ where: { telegramUserId: user.id } });
    if (existing) throw new ConflictException(`Вы уже подали заявку. Статус: ${STATUS_RU[existing.verificationStatus]}.`);
    const { consent: _consent, ...data } = input;
    const [, translator] = await this.prisma.$transaction([
      this.prisma.telegramUser.update({ where: { id: user.id }, data: { consentAt: user.consentAt ?? new Date() } }),
      this.prisma.translator.create({
        data: { ...data, telegramUserId: user.id, telegramUsername: user.username },
      }),
    ]);
    return { id: translator.id, status: translator.verificationStatus };
  }

  async createJob(user: TelegramUser, input: TranslationJobCreateInput) {
    const translator = await this.prisma.translator.findFirst({
      where: { id: input.translatorId, verificationStatus: 'VERIFIED' },
      include: { telegramUser: true },
    });
    if (!translator) throw new NotFoundException('Переводчик не найден');
    const recent = await this.prisma.translationJob.count({
      where: { requesterTelegramUserId: user.id, createdAt: { gte: new Date(Date.now() - 60 * 60 * 1000) } },
    });
    if (recent >= MAX_JOBS_PER_HOUR) throw new HttpException('Слишком много заявок. Попробуйте через час.', HttpStatus.TOO_MANY_REQUESTS);

    const { consent: _consent, translatorId, deadline, scheduledAt, ...data } = input;
    const [, job] = await this.prisma.$transaction([
      this.prisma.telegramUser.update({ where: { id: user.id }, data: { consentAt: user.consentAt ?? new Date() } }),
      this.prisma.translationJob.create({
        data: {
          ...data,
          translatorId,
          requesterType: 'TOURIST',
          requesterTelegramUserId: user.id,
          status: 'ASSIGNED',
          deadline: deadline ? new Date(`${deadline}T00:00:00Z`) : undefined,
          scheduledAt: scheduledAt ? new Date(scheduledAt) : undefined,
        },
      }),
    ]);
    const delivered = await this.sendOffer(job.id);
    if (!delivered) {
      // Staff pick it up from the queue and reach the translator another way, or reassign.
      await this.prisma.translationJob.update({ where: { id: job.id }, data: { status: 'REQUESTED' } });
    }
    return { id: job.id, translatorName: translator.name };
  }

  // ── Bot button presses ────────────────────────────────────────────────────

  async botAction(jobId: string, telegramId: number, action: 'accept' | 'decline' | 'complete'): Promise<{ message: string }> {
    const job = await this.loadJob(jobId);
    if (job.translator?.telegramUser?.telegramId !== BigInt(telegramId)) throw new ForbiddenException('Эта заявка не для вас');
    const name = job.translator.name;
    const requester = job.requesterTelegramUser;

    if (action === 'accept') {
      await this.transition(jobId, ['ASSIGNED'], 'IN_PROGRESS', 'Заявка уже не ждёт ответа');
      if (requester) {
        await this.notify(requester.telegramId, `Переводчик <b>${html(name)}</b> принял вашу заявку. Напишите ему, чтобы договориться: ${contactOf(job.translator.telegramUser!)}`);
      }
      await this.notify(
        BigInt(telegramId),
        requester
          ? `Контакт клиента: ${contactOf(requester)}. Когда закончите, нажмите кнопку ниже — клиент сможет поставить оценку.`
          : 'Заявка от компании: контакт пришлёт наш менеджер. Когда закончите, нажмите кнопку ниже.',
        { inline_keyboard: [[{ text: 'Работа выполнена', callback_data: `job:complete:${jobId}` }]] },
      );
      return { message: 'Вы приняли заявку. Контакт клиента — в чате.' };
    }

    if (action === 'decline') {
      await this.transition(jobId, ['ASSIGNED'], 'REQUESTED', 'Заявка уже не ждёт ответа', { translatorId: null });
      if (requester) await this.notify(requester.telegramId, `${html(name)} не сможет взять заявку. Мы подберём другого переводчика и напишем вам.`);
      return { message: 'Вы отказались от заявки. Спасибо, что ответили.' };
    }

    await this.transition(jobId, ['IN_PROGRESS'], 'COMPLETED', 'Заявка не в работе', { completedAt: new Date() });
    await this.recomputeStats(job.translator.id);
    if (requester) {
      await this.notify(requester.telegramId, `Как прошла работа с переводчиком <b>${html(name)}</b>? Оцените от 1 до 5:`, {
        inline_keyboard: [[1, 2, 3, 4, 5].map((n) => ({ text: '★'.repeat(n), callback_data: `job:rate:${jobId}:${n}` }))],
      });
    }
    return { message: 'Отмечено как выполненное. Спасибо!' };
  }

  async rate(jobId: string, telegramId: number, rating: number): Promise<{ message: string }> {
    const job = await this.loadJob(jobId);
    if (job.requesterTelegramUser?.telegramId !== BigInt(telegramId)) throw new ForbiddenException('Эта заявка не ваша');
    const { count } = await this.prisma.translationJob.updateMany({ where: { id: jobId, status: 'COMPLETED', rating: null }, data: { rating } });
    if (count === 0) throw new ConflictException('Оценка уже поставлена');
    if (job.translatorId) await this.recomputeStats(job.translatorId);
    return { message: 'Спасибо за оценку!' };
  }

  // ── Admin ─────────────────────────────────────────────────────────────────

  listTranslators(status?: TranslatorVerificationStatus) {
    return this.prisma.translator.findMany({
      where: { verificationStatus: status },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      include: { telegramUser: { select: { username: true } }, spotCheckedBy: { select: { name: true } }, _count: { select: { jobs: true } } },
    });
  }

  async getTranslator(id: string) {
    const t = await this.prisma.translator.findUnique({
      where: { id },
      include: {
        telegramUser: { select: { username: true, telegramId: true } },
        spotCheckedBy: { select: { name: true } },
        jobs: { orderBy: { createdAt: 'desc' }, take: 50, include: jobInclude },
      },
    });
    if (!t) throw new NotFoundException('Translator not found');
    const history = await this.prisma.auditLog.findMany({
      where: { entityType: 'translator', entityId: id },
      orderBy: { createdAt: 'desc' },
      include: { actorAdmin: { select: { id: true, name: true } } },
    });
    return { ...t, telegramUser: t.telegramUser && { username: t.telegramUser.username, telegramId: t.telegramUser.telegramId.toString() }, history };
  }

  async decide(id: string, { decision, notes }: TranslatorDecisionInput, admin: AdminUser) {
    const { from, to } = TRANSLATOR_TRANSITIONS[decision];
    const translator = await this.prisma.$transaction(async (tx) => {
      const { count } = await tx.translator.updateMany({
        where: { id, verificationStatus: { in: [...from] } },
        data: { verificationStatus: to, spotCheckNotes: notes, spotCheckedAt: new Date(), spotCheckedById: admin.id },
      });
      if (count === 0) {
        const current = await tx.translator.findUnique({ where: { id }, select: { verificationStatus: true } });
        if (!current) throw new NotFoundException('Translator not found');
        throw new ConflictException(`Cannot ${decision} a translator whose status is ${current.verificationStatus}`);
      }
      await tx.auditLog.create({ data: { actorAdminId: admin.id, action: `translator.${decision}`, entityType: 'translator', entityId: id, reason: notes, metadata: { to } } });
      return tx.translator.findUniqueOrThrow({ where: { id }, include: { telegramUser: true } });
    });
    // Internal notes stay internal; the translator gets a plain message.
    const message = {
      verify: 'Ваш профиль проверен и опубликован в каталоге переводчиков. Заявки будут приходить сюда.',
      reject: 'Спасибо за заявку. Сейчас мы не можем добавить ваш профиль в каталог.',
      suspend: 'Ваш профиль временно скрыт из каталога. Если есть вопросы, напишите нам.',
    }[decision];
    if (translator.telegramUser) await this.notify(translator.telegramUser.telegramId, message);
    this.revalidation.revalidate('translators');
    const { telegramUser: _t, ...rest } = translator;
    return rest;
  }

  async listJobs(q: TranslationJobListQuery) {
    const where: Prisma.TranslationJobWhereInput = { status: q.status };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.translationJob.findMany({ where, include: jobInclude, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], skip: (q.page - 1) * q.pageSize, take: q.pageSize }),
      this.prisma.translationJob.count({ where }),
    ]);
    return { items, total, page: q.page, pageSize: q.pageSize };
  }

  async assign(jobId: string, translatorId: string, admin: AdminUser) {
    const translator = await this.prisma.translator.findFirst({ where: { id: translatorId, verificationStatus: 'VERIFIED' } });
    if (!translator) throw new NotFoundException('Verified translator not found');
    await this.transition(jobId, ['REQUESTED', 'ASSIGNED'], 'ASSIGNED', 'Only waiting jobs can be (re)assigned', { translatorId });
    await this.prisma.auditLog.create({ data: { actorAdminId: admin.id, action: 'translation_job.assign', entityType: 'translation_job', entityId: jobId, metadata: { translatorId } } });
    const offerDelivered = await this.sendOffer(jobId);
    return { job: await this.prisma.translationJob.findUniqueOrThrow({ where: { id: jobId }, include: jobInclude }), offerDelivered };
  }

  async cancel(jobId: string, reason: string, admin: AdminUser) {
    const job = await this.loadJob(jobId);
    await this.transition(jobId, ['REQUESTED', 'ASSIGNED', 'IN_PROGRESS'], 'CANCELLED', 'Job is already finished');
    await this.prisma.auditLog.create({ data: { actorAdminId: admin.id, action: 'translation_job.cancel', entityType: 'translation_job', entityId: jobId, reason } });
    if (job.requesterTelegramUser) await this.notify(job.requesterTelegramUser.telegramId, 'Ваша заявка на перевод отменена. Если перевод ещё нужен, отправьте новую заявку.');
    return this.prisma.translationJob.findUniqueOrThrow({ where: { id: jobId }, include: jobInclude });
  }

  // ── Internals ─────────────────────────────────────────────────────────────

  private loadJob(id: string) {
    return this.prisma.translationJob
      .findUniqueOrThrow({ where: { id }, include: { translator: { include: { telegramUser: true } }, requesterTelegramUser: true } })
      .catch(() => {
        throw new NotFoundException('Заявка не найдена');
      });
  }

  /** Conditional status change so double taps and races can't apply twice. */
  private async transition(id: string, from: TranslationJobStatus[], to: TranslationJobStatus, conflict: string, extra: Prisma.TranslationJobUncheckedUpdateManyInput = {}) {
    const { count } = await this.prisma.translationJob.updateMany({ where: { id, status: { in: from } }, data: { status: to, ...extra } });
    if (count === 0) throw new ConflictException(conflict);
  }

  /** Sends the job to its translator with Accept / Decline buttons. False if they can't be reached in Telegram. */
  private async sendOffer(jobId: string): Promise<boolean> {
    const job = await this.loadJob(jobId);
    const chat = job.translator?.telegramUser?.telegramId;
    if (!chat) return false;
    const when = job.type === 'LIVE'
      ? job.scheduledAt ? `\nКогда: ${job.scheduledAt.toISOString().slice(0, 16).replace('T', ' ')} UTC` : ''
      : job.deadline ? `\nСрок: ${job.deadline.toISOString().slice(0, 10)}` : '';
    const text = [
      `<b>Новая заявка: ${job.type === 'LIVE' ? 'устный перевод' : 'перевод документа'}</b>`,
      `${lang(job.sourceLanguage)} → ${lang(job.targetLanguage)}${when}`,
      '',
      html(job.description ?? ''),
      '',
      'Примете? Контакт клиента придёт после согласия.',
    ].join('\n');
    return this.notify(chat, text, {
      inline_keyboard: [[{ text: 'Принять', callback_data: `job:accept:${jobId}` }, { text: 'Не смогу', callback_data: `job:decline:${jobId}` }]],
    });
  }

  private async notify(chatId: bigint, text: string, replyMarkup?: object): Promise<boolean> {
    try {
      await this.bot.sendMessage(chatId, text, { parse_mode: 'HTML', ...(replyMarkup && { reply_markup: replyMarkup }) });
      return true;
    } catch (e) {
      this.logger.warn(`Telegram message to ${chatId} failed: ${(e as Error).message}`);
      return false;
    }
  }

  /** jobs_completed and rating are caches on translators (spec model); recompute from jobs. */
  private async recomputeStats(translatorId: string) {
    const [completed, avg] = await Promise.all([
      this.prisma.translationJob.count({ where: { translatorId, status: 'COMPLETED' } }),
      this.prisma.translationJob.aggregate({ where: { translatorId, status: 'COMPLETED', rating: { not: null } }, _avg: { rating: true } }),
    ]);
    await this.prisma.translator.update({
      where: { id: translatorId },
      data: { jobsCompleted: completed, rating: avg._avg.rating === null ? null : new Prisma.Decimal(avg._avg.rating.toFixed(2)) },
    });
    this.revalidation.revalidate('translators');
  }
}

const STATUS_RU: Record<TranslatorVerificationStatus, string> = {
  PENDING: 'на проверке',
  VERIFIED: 'проверен',
  REJECTED: 'отклонён',
  SUSPENDED: 'временно скрыт',
};

function toPublic(t: Translator): PublicTranslator {
  return {
    id: t.id,
    name: t.name,
    languages: t.languages,
    proficiency: t.proficiency as Record<string, string>,
    specialtyCountryCode: t.specialtyCountryCode,
    specialties: t.specialties,
    bioRu: t.bioRu,
    jobsCompleted: t.jobsCompleted,
    rating: t.rating === null ? null : Number(t.rating),
  };
}
