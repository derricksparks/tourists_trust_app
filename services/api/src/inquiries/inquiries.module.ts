import {
  BadGatewayException,
  Body,
  ConflictException,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  Injectable,
  Module,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { Account, AdminUser, Inquiry, InquiryStatus, Operator, Prisma, ReplyDelivery, TelegramUser } from '@prisma/client';
import {
  InquiryListQuery,
  InquiryReplyInput,
  InquiryStatusInput,
  inquiryListQuerySchema,
  inquiryReplySchema,
  inquiryStatusSchema,
} from '@ttp/shared-types';
import { AdminAuthGuard, AdminRoles, CurrentAdmin } from '../admin-auth/admin-auth.guard';
import { PrismaService } from '../common/prisma.service';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { MailService } from '../mail/mail.service';
import { CurrentAccount, PortalAccount, PortalAuthGuard, PortalRoles } from '../portal/portal-auth';
import { ScoringService } from '../scoring/scoring.service';
import { z } from 'zod';
import { TelegramApiError, TelegramBotApi } from '../telegram/bot-api';

const FROM: Record<'RESPONDED' | 'CLOSED', InquiryStatus[]> = {
  RESPONDED: ['NEW'],
  CLOSED: ['NEW', 'RESPONDED'],
};

const include = {
  operator: { select: { id: true, name: true, slug: true, email: true, phone: true, telegramUsername: true, websiteUrl: true } },
  package: { select: { title: true, titleRu: true } },
  telegramUser: { select: { username: true, firstName: true, lastName: true, languageCode: true } },
  replies: {
    orderBy: { createdAt: 'asc' },
    include: { authorAccount: { select: { email: true } }, authorAdmin: { select: { name: true } } },
  },
} satisfies Prisma.InquiryInclude;

const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

type Author = { kind: 'operator'; account: Account } | { kind: 'staff'; admin: AdminUser };

/**
 * Traveller questions ("request info" from the Mini App). Operators answer them in the partner
 * portal; staff see all of them and can answer on an operator's behalf. Either way the answer
 * reaches the traveller by the route they came in on: the Telegram bot, or email when there is
 * no Telegram contact. Only the operator's own answers count for the response-time score (TV-6).
 */
@Injectable()
export class InquiriesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly bot: TelegramBotApi,
    private readonly mail: MailService,
    private readonly scoring: ScoringService,
  ) {}

  async list(q: InquiryListQuery) {
    const where: Prisma.InquiryWhereInput = { status: q.status };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.inquiry.findMany({
        where,
        include,
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
      }),
      this.prisma.inquiry.count({ where }),
    ]);
    return { items, total, page: q.page, pageSize: q.pageSize };
  }

  /**
   * Sends an answer to the traveller and records it. The answer is stored only once it was
   * delivered, so the history never shows an answer the traveller didn't get.
   */
  async answer(id: string, text: string, author: Author, operatorId?: string) {
    const inquiry = await this.prisma.inquiry.findFirst({ where: { id, ...(operatorId && { operatorId }) }, include: { operator: true, telegramUser: true } });
    if (!inquiry) throw new NotFoundException('Inquiry not found');
    if (inquiry.status === 'CLOSED') throw new ConflictException('This question is closed');
    const deliveredVia = await this.deliver(inquiry, text);
    const updated = await this.prisma.$transaction(async (tx) => {
      await tx.inquiryReply.create({
        data: {
          inquiryId: id,
          body: text,
          deliveredVia,
          ...(author.kind === 'operator' ? { authorAccountId: author.account.id } : { authorAdminId: author.admin.id }),
        },
      });
      await tx.inquiry.update({
        where: { id },
        data: { status: inquiry.status === 'NEW' ? 'RESPONDED' : inquiry.status, firstResponseAt: inquiry.firstResponseAt ?? new Date() },
      });
      await tx.auditLog.create({
        data: {
          ...(author.kind === 'operator' ? { actorAccountId: author.account.id } : { actorAdminId: author.admin.id }),
          action: author.kind === 'operator' ? 'inquiry.operator_reply' : 'inquiry.reply',
          entityType: 'inquiry',
          entityId: id,
          metadata: { text, deliveredVia, ...(author.kind === 'staff' && { onBehalfOf: inquiry.operatorId }) },
        },
      });
      return tx.inquiry.findUniqueOrThrow({ where: { id }, include });
    });
    await this.scoring.recompute(inquiry.operatorId);
    return updated;
  }

  private async deliver(inquiry: Inquiry & { operator: Operator; telegramUser: TelegramUser | null }, text: string): Promise<ReplyDelivery> {
    if (inquiry.telegramUser) {
      try {
        await this.bot.sendMessage(inquiry.telegramUser.telegramId, `Ответ на ваш вопрос к ${inquiry.operator.name}:\n\n${text}`);
        return 'TELEGRAM';
      } catch (e) {
        if (e instanceof TelegramApiError && e.errorCode === 403) {
          throw new ConflictException('The traveller has blocked the bot or never started it, so Telegram refused the message');
        }
        throw new BadGatewayException(e instanceof TelegramApiError ? `Telegram refused the message: ${e.description}` : 'Could not reach Telegram');
      }
    }
    if (inquiry.contactInfo && EMAIL.test(inquiry.contactInfo)) {
      try {
        await this.mail.send({
          to: [inquiry.contactInfo],
          subject: `Ответ на ваш вопрос к ${inquiry.operator.name}`,
          text: `Здравствуйте${inquiry.contactName ? `, ${inquiry.contactName}` : ''}!\n\n${inquiry.operator.name} ответил на ваш вопрос:\n\n«${inquiry.message}»\n\n${text}\n\n—\nКоманда «Проверено: Африка»`,
        });
        return 'EMAIL';
      } catch (e) {
        throw new BadGatewayException(`Could not send the email: ${(e as Error).message}`);
      }
    }
    throw new ConflictException('There is no Telegram chat or email address to send the answer to');
  }

  async setStatus(id: string, { status }: InquiryStatusInput, admin: AdminUser) {
    const updated = await this.prisma.$transaction(async (tx) => {
      const { count } = await tx.inquiry.updateMany({
        where: { id, status: { in: FROM[status] } },
        data: { status, ...(status === 'RESPONDED' && { firstResponseAt: new Date() }) },
      });
      if (count === 0) {
        const current = await tx.inquiry.findUnique({ where: { id }, select: { status: true } });
        if (!current) throw new NotFoundException('Inquiry not found');
        throw new ConflictException(`Inquiry is already ${current.status.toLowerCase()}`);
      }
      await tx.auditLog.create({
        data: { actorAdminId: admin.id, action: `inquiry.${status.toLowerCase()}`, entityType: 'inquiry', entityId: id },
      });
      return tx.inquiry.findUniqueOrThrow({ where: { id }, include });
    });
    await this.scoring.recompute(updated.operator.id);
    return updated;
  }
}

/** What an operator sees of a question: no Telegram handle or contact details (answers go through us). */
function operatorView(i: Prisma.InquiryGetPayload<{ include: typeof include }>) {
  return {
    id: i.id,
    status: i.status,
    createdAt: i.createdAt,
    firstResponseAt: i.firstResponseAt,
    travellerName: i.contactName?.split(' ')[0] ?? null,
    message: i.message,
    travelMonth: i.travelMonth,
    groupSize: i.groupSize,
    package: i.package,
    channel: i.telegramUser ? 'TELEGRAM' : 'EMAIL',
    replies: i.replies.map((r) => ({ id: r.id, body: r.body, createdAt: r.createdAt, deliveredVia: r.deliveredVia, by: r.authorAdminId ? 'staff' : 'operator' })),
  };
}

/** The operator's inbox in the partner portal. */
@Controller('portal/operator/inquiries')
@UseGuards(PortalAuthGuard)
@PortalRoles('OPERATOR')
export class OperatorInquiriesController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly svc: InquiriesService,
  ) {}

  @Get()
  async list(@Query(new ZodValidationPipe(z.object({ status: z.enum(['NEW', 'RESPONDED', 'CLOSED']).optional() }))) q: { status?: InquiryStatus }, @CurrentAccount() a: PortalAccount) {
    if (!a.operator) throw new ForbiddenException();
    const rows = await this.prisma.inquiry.findMany({ where: { operatorId: a.operator.id, status: q.status }, include, orderBy: [{ status: 'asc' }, { createdAt: 'desc' }], take: 200 });
    return rows.map(operatorView);
  }

  @Post(':id/reply')
  @HttpCode(200)
  async reply(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodValidationPipe(inquiryReplySchema)) body: InquiryReplyInput, @CurrentAccount() a: PortalAccount) {
    if (!a.operator) throw new ForbiddenException();
    if (a.operator.status !== 'APPROVED') throw new ForbiddenException('Your listing is not active, so you can’t answer travellers right now. Contact us.');
    return operatorView(await this.svc.answer(id, body.text, { kind: 'operator', account: a }, a.operator.id));
  }
}

@Controller('admin/inquiries')
@UseGuards(AdminAuthGuard)
export class AdminInquiriesController {
  constructor(private readonly svc: InquiriesService) {}

  @Get()
  list(@Query(new ZodValidationPipe(inquiryListQuerySchema)) q: InquiryListQuery) {
    return this.svc.list(q);
  }

  @Post(':id/reply')
  @HttpCode(200)
  @AdminRoles('SUPER_ADMIN', 'MODERATOR')
  reply(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(inquiryReplySchema)) body: InquiryReplyInput,
    @CurrentAdmin() admin: AdminUser,
  ) {
    return this.svc.answer(id, body.text, { kind: 'staff', admin });
  }

  @Post(':id/status')
  @HttpCode(200)
  @AdminRoles('SUPER_ADMIN', 'MODERATOR')
  setStatus(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(inquiryStatusSchema)) body: InquiryStatusInput,
    @CurrentAdmin() admin: AdminUser,
  ) {
    return this.svc.setStatus(id, body, admin);
  }
}

@Module({ controllers: [AdminInquiriesController, OperatorInquiriesController], providers: [InquiriesService], exports: [InquiriesService] })
export class InquiriesModule {}
