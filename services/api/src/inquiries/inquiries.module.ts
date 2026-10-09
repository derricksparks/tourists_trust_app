import {
  BadGatewayException,
  Body,
  ConflictException,
  Controller,
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
import { AdminUser, InquiryStatus, Prisma } from '@prisma/client';
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
import { TelegramApiError, TelegramBotApi } from '../telegram/bot-api';

const FROM: Record<'RESPONDED' | 'CLOSED', InquiryStatus[]> = {
  RESPONDED: ['NEW'],
  CLOSED: ['NEW', 'RESPONDED'],
};

const include = {
  operator: { select: { id: true, name: true, slug: true, email: true, phone: true, telegramUsername: true, websiteUrl: true } },
  package: { select: { title: true, titleRu: true } },
  telegramUser: { select: { username: true, firstName: true, lastName: true, languageCode: true } },
} satisfies Prisma.InquiryInclude;

/**
 * Inbox of "request info" messages from tourists. Until the operator portal exists, staff pass
 * each one to the operator and mark it responded once the operator has replied; that timestamp
 * feeds the response-time score (TV-6).
 */
@Injectable()
export class InquiriesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly bot: TelegramBotApi,
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
   * Sends the operator's answer (typed or pasted by staff) to the traveller in the bot chat,
   * marks the inquiry responded and keeps the text in the audit log.
   */
  async reply(id: string, { text }: InquiryReplyInput, admin: AdminUser) {
    const inquiry = await this.prisma.inquiry.findUnique({ where: { id }, include: { operator: true, telegramUser: true } });
    if (!inquiry) throw new NotFoundException('Inquiry not found');
    if (!inquiry.telegramUser) throw new ConflictException('This inquiry did not come from Telegram, so there is no chat to reply in');
    try {
      await this.bot.sendMessage(inquiry.telegramUser.telegramId, `Ответ на ваш вопрос к ${inquiry.operator.name}:\n\n${text}`);
    } catch (e) {
      if (e instanceof TelegramApiError && e.errorCode === 403) {
        throw new ConflictException('The traveller has blocked the bot or never started it, so Telegram refused the message');
      }
      throw new BadGatewayException(e instanceof TelegramApiError ? `Telegram refused the message: ${e.description}` : 'Could not reach Telegram');
    }
    return this.prisma.$transaction(async (tx) => {
      await tx.inquiry.update({
        where: { id },
        data: { status: inquiry.status === 'NEW' ? 'RESPONDED' : inquiry.status, firstResponseAt: inquiry.firstResponseAt ?? new Date() },
      });
      await tx.auditLog.create({
        data: { actorAdminId: admin.id, action: 'inquiry.reply', entityType: 'inquiry', entityId: id, metadata: { text } },
      });
      return tx.inquiry.findUniqueOrThrow({ where: { id }, include });
    });
  }

  async setStatus(id: string, { status }: InquiryStatusInput, admin: AdminUser) {
    return this.prisma.$transaction(async (tx) => {
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
    return this.svc.reply(id, body, admin);
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

@Module({ controllers: [AdminInquiriesController], providers: [InquiriesService, TelegramBotApi] })
export class InquiriesModule {}
