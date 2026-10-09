import {
  Body,
  CanActivate,
  Controller,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
  Module,
  NotFoundException,
  Post,
  ServiceUnavailableException,
  UnauthorizedException,
  UseGuards,
  createParamDecorator,
} from '@nestjs/common';
import { TelegramUser } from '@prisma/client';
import { InquiryCreateInput, inquiryCreateSchema } from '@ttp/shared-types';
import { Request } from 'express';
import { PrismaService } from '../common/prisma.service';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { validateInitData } from './init-data';

type TelegramRequest = Request & { telegramUser?: TelegramUser };

export const CurrentTelegramUser = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): TelegramUser => ctx.switchToHttp().getRequest<TelegramRequest>().telegramUser!,
);

/**
 * Authenticates Mini App requests: `Authorization: tma <initData>`, signed by Telegram with our
 * bot token. Creates or refreshes the telegram_users row for the sender.
 */
@Injectable()
export class TelegramAuthGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const botToken = process.env.TELEGRAM_BOT_TOKEN;
    if (!botToken) throw new ServiceUnavailableException('Telegram is not configured');
    const req = ctx.switchToHttp().getRequest<TelegramRequest>();
    const [scheme, initData] = (req.headers.authorization ?? '').split(/ (.*)/s);
    if (scheme !== 'tma' || !initData) throw new UnauthorizedException();
    const user = validateInitData(initData, botToken);
    if (!user) throw new UnauthorizedException('Invalid or expired Telegram data');

    const profile = {
      username: user.username ?? null,
      firstName: user.first_name ?? null,
      lastName: user.last_name ?? null,
      languageCode: user.language_code ?? null,
    };
    req.telegramUser = await this.prisma.telegramUser.upsert({
      where: { telegramId: BigInt(user.id) },
      create: { telegramId: BigInt(user.id), ...profile },
      update: profile,
    });
    return true;
  }
}

const MAX_INQUIRIES_PER_HOUR = 5;

@Controller('public/telegram')
@UseGuards(TelegramAuthGuard)
export class TelegramController {
  constructor(private readonly prisma: PrismaService) {}

  /** "Request info" from the Mini App. Staff see it in the admin inbox and pass it to the operator. */
  @Post('inquiries')
  async createInquiry(
    @Body(new ZodValidationPipe(inquiryCreateSchema)) body: InquiryCreateInput,
    @CurrentTelegramUser() user: TelegramUser,
  ) {
    const operator = await this.prisma.operator.findFirst({ where: { slug: body.operatorSlug, status: 'APPROVED' } });
    if (!operator) throw new NotFoundException('Operator not found');
    const pkg = body.packageSlug
      ? await this.prisma.package.findFirst({ where: { slug: body.packageSlug, operatorId: operator.id, status: 'PUBLISHED' } })
      : null;
    if (body.packageSlug && !pkg) throw new NotFoundException('Package not found');

    const recent = await this.prisma.inquiry.count({
      where: { telegramUserId: user.id, createdAt: { gte: new Date(Date.now() - 60 * 60 * 1000) } },
    });
    if (recent >= MAX_INQUIRIES_PER_HOUR) {
      throw new HttpException('Слишком много запросов. Попробуйте через час.', HttpStatus.TOO_MANY_REQUESTS);
    }

    const [, inquiry] = await this.prisma.$transaction([
      this.prisma.telegramUser.update({ where: { id: user.id }, data: { consentAt: user.consentAt ?? new Date() } }),
      this.prisma.inquiry.create({
        data: {
          telegramUserId: user.id,
          operatorId: operator.id,
          packageId: pkg?.id,
          channel: 'TELEGRAM',
          contactName: [user.firstName, user.lastName].filter(Boolean).join(' ') || null,
          contactInfo: user.username ? `@${user.username}` : `tg://user?id=${user.telegramId}`,
          message: body.message,
          travelMonth: body.travelMonth,
          groupSize: body.groupSize,
        },
      }),
    ]);
    return { id: inquiry.id, operatorName: operator.name, createdAt: inquiry.createdAt };
  }
}

@Module({ controllers: [TelegramController], providers: [TelegramAuthGuard] })
export class TelegramModule {}
