import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Get,
  HttpCode,
  Injectable,
  Logger,
  Module,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AdminUser, Prisma, ReviewInvite } from '@prisma/client';
import {
  InviteStats,
  PublicReviewInvite,
  ReviewInviteCreateInput,
  ReviewInviteState,
  ReviewSubmitInput,
  reviewInviteCreateSchema,
  reviewSubmitSchema,
} from '@ttp/shared-types';
import { createHash, randomBytes } from 'crypto';
import { z } from 'zod';
import { AdminAuthGuard, AdminRoles, CurrentAdmin } from '../admin-auth/admin-auth.guard';
import { PrismaService } from '../common/prisma.service';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { TelegramBotApi } from '../telegram/bot-api';

const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');
const siteUrl = () => (process.env.SITE_URL ?? 'http://localhost:3001').replace(/\/$/, '');
export const reviewLink = (token: string) => `${siteUrl()}/review/${token}`;

export function inviteState(i: Pick<ReviewInvite, 'usedAt' | 'revokedAt' | 'expiresAt'>, now = new Date()): ReviewInviteState {
  if (i.usedAt) return 'used';
  if (i.revokedAt) return 'revoked';
  if (i.expiresAt <= now) return 'expired';
  return 'open';
}

/**
 * Review invites (decision B5.6): only someone holding a one-time link can write a review.
 * Links are random 32-byte tokens; only their SHA-256 is stored, so the link is shown once.
 */
@Injectable()
export class ReviewInvitesService {
  private readonly logger = new Logger(ReviewInvitesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly bot: TelegramBotApi,
  ) {}

  async create(input: ReviewInviteCreateInput, admin: AdminUser) {
    const operator = await this.prisma.operator.findUnique({ where: { id: input.operatorId } });
    if (!operator) throw new NotFoundException('Operator not found');
    if (operator.status !== 'APPROVED') throw new ConflictException('Only approved operators can collect reviews');
    if (input.packageId) {
      const pkg = await this.prisma.package.findFirst({ where: { id: input.packageId, operatorId: operator.id } });
      if (!pkg) throw new BadRequestException('That tour does not belong to this operator');
    }
    const inquiry = input.inquiryId
      ? await this.prisma.inquiry.findUnique({ where: { id: input.inquiryId }, include: { telegramUser: true } })
      : null;
    if (input.inquiryId && (!inquiry || inquiry.operatorId !== operator.id)) throw new BadRequestException('That inquiry is not about this operator');

    const token = randomBytes(32).toString('base64url');
    const invite = await this.prisma.reviewInvite
      .create({
        data: {
          tokenHash: hashToken(token),
          operatorId: operator.id,
          packageId: input.packageId,
          inquiryId: input.inquiryId,
          recipientName: input.recipientName,
          recipientContact: input.recipientContact,
          tripDate: new Date(`${input.tripDate}T00:00:00Z`),
          issuedById: admin.id,
          expiresAt: new Date(Date.now() + input.expiresInDays * 24 * 60 * 60 * 1000),
        },
      })
      .catch((e) => {
        if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') throw new ConflictException('This inquiry already has a review invite');
        throw e;
      });
    await this.prisma.auditLog.create({
      data: { actorAdminId: admin.id, action: 'review_invite.create', entityType: 'review_invite', entityId: invite.id, metadata: { operatorId: operator.id, fromInquiry: !!inquiry } },
    });

    const link = reviewLink(token);
    let sentInTelegram = false;
    if (input.sendTelegram && inquiry?.telegramUser) {
      try {
        await this.bot.sendMessage(
          inquiry.telegramUser.telegramId,
          `Как прошла поездка с ${operator.name}? Расскажите другим путешественникам — отзыв займёт пару минут. Ссылка личная и работает один раз.`,
          { reply_markup: { inline_keyboard: [[{ text: 'Оставить отзыв', url: link }]] } },
        );
        sentInTelegram = true;
      } catch (e) {
        this.logger.warn(`Invite not delivered in Telegram: ${(e as Error).message}`);
      }
    }
    return { invite: { ...invite, state: inviteState(invite) }, link, sentInTelegram };
  }

  async list(operatorId?: string) {
    const rows = await this.prisma.reviewInvite.findMany({
      where: { operatorId },
      orderBy: { createdAt: 'desc' },
      take: 200,
      include: {
        operator: { select: { id: true, name: true } },
        package: { select: { title: true } },
        review: { select: { id: true, status: true, rating: true } },
        issuedBy: { select: { name: true } },
      },
    });
    return rows.map(({ tokenHash: _h, ...r }) => ({ ...r, state: inviteState(r) }));
  }

  async revoke(id: string, admin: AdminUser) {
    const { count } = await this.prisma.reviewInvite.updateMany({ where: { id, usedAt: null, revokedAt: null }, data: { revokedAt: new Date() } });
    if (count === 0) {
      const exists = await this.prisma.reviewInvite.findUnique({ where: { id } });
      if (!exists) throw new NotFoundException('Invite not found');
      throw new ConflictException('This invite has already been used or revoked');
    }
    await this.prisma.auditLog.create({ data: { actorAdminId: admin.id, action: 'review_invite.revoke', entityType: 'review_invite', entityId: id } });
    return { ok: true };
  }

  async stats(operatorId: string): Promise<InviteStats> {
    const invites = await this.prisma.reviewInvite.findMany({
      where: { operatorId },
      select: { usedAt: true, revokedAt: true, expiresAt: true, inquiryId: true, review: { select: { status: true } } },
    });
    const s: InviteStats = { sent: invites.length, used: 0, open: 0, expired: 0, revoked: 0, published: 0, fromInquiries: 0 };
    for (const i of invites) {
      s[inviteState(i)]++;
      if (i.review?.status === 'PUBLISHED') s.published++;
      if (i.inquiryId) s.fromInquiries++;
    }
    return s;
  }

  // ── Public (the traveller with the link) ──────────────────────────────────

  async lookup(token: string): Promise<PublicReviewInvite> {
    const invite = await this.prisma.reviewInvite.findUnique({
      where: { tokenHash: hashToken(token) },
      include: { operator: true, package: { select: { title: true, titleRu: true } } },
    });
    if (!invite) throw new NotFoundException('Ссылка не найдена');
    return {
      state: invite.operator.status === 'APPROVED' ? inviteState(invite) : 'revoked',
      operatorName: invite.operator.name,
      operatorSlug: invite.operator.slug,
      packageTitle: invite.package ? (invite.package.titleRu ?? invite.package.title) : null,
      recipientName: invite.recipientName,
      tripDate: invite.tripDate.toISOString().slice(0, 10),
    };
  }

  async submit(token: string, input: ReviewSubmitInput) {
    const tokenHash = hashToken(token);
    return this.prisma.$transaction(async (tx) => {
      const invite = await tx.reviewInvite.findUnique({ where: { tokenHash }, include: { operator: { select: { status: true } } } });
      if (!invite) throw new NotFoundException('Ссылка не найдена');
      // Claim the invite first, conditionally, so a double submit can't create two reviews.
      const { count } = await tx.reviewInvite.updateMany({
        where: { id: invite.id, usedAt: null, revokedAt: null, expiresAt: { gt: new Date() } },
        data: { usedAt: new Date() },
      });
      if (count === 0 || invite.operator.status !== 'APPROVED') throw new ConflictException('Эта ссылка уже использована или больше не действует');
      const { consent: _c, ...review } = input;
      const created = await tx.review.create({
        data: { ...review, operatorId: invite.operatorId, packageId: invite.packageId, inviteId: invite.id, tripDate: invite.tripDate, originalLanguage: 'ru', status: 'PENDING' },
      });
      return { id: created.id, status: created.status };
    });
  }
}

const listQuery = z.object({ operatorId: z.string().uuid().optional() });
const token = z.string().regex(/^[A-Za-z0-9_-]{20,100}$/);

@Controller()
export class ReviewInvitesController {
  constructor(private readonly svc: ReviewInvitesService) {}

  @Get('admin/review-invites')
  @UseGuards(AdminAuthGuard)
  list(@Query(new ZodValidationPipe(listQuery)) q: z.infer<typeof listQuery>) {
    return this.svc.list(q.operatorId);
  }

  @Get('admin/operators/:id/invite-stats')
  @UseGuards(AdminAuthGuard)
  stats(@Param('id', ParseUUIDPipe) id: string) {
    return this.svc.stats(id);
  }

  @Post('admin/review-invites')
  @UseGuards(AdminAuthGuard)
  @AdminRoles('SUPER_ADMIN', 'MODERATOR')
  create(@Body(new ZodValidationPipe(reviewInviteCreateSchema)) body: ReviewInviteCreateInput, @CurrentAdmin() admin: AdminUser) {
    return this.svc.create(body, admin);
  }

  @Post('admin/review-invites/:id/revoke')
  @HttpCode(200)
  @UseGuards(AdminAuthGuard)
  @AdminRoles('SUPER_ADMIN', 'MODERATOR')
  revoke(@Param('id', ParseUUIDPipe) id: string, @CurrentAdmin() admin: AdminUser) {
    return this.svc.revoke(id, admin);
  }

  @Get('public/review-invites/:token')
  lookup(@Param('token', new ZodValidationPipe(token)) t: string) {
    return this.svc.lookup(t);
  }

  @Post('public/review-invites/:token')
  submit(@Param('token', new ZodValidationPipe(token)) t: string, @Body(new ZodValidationPipe(reviewSubmitSchema)) body: ReviewSubmitInput) {
    return this.svc.submit(t, body);
  }
}

@Module({ controllers: [ReviewInvitesController], providers: [ReviewInvitesService] })
export class ReviewInvitesModule {}
