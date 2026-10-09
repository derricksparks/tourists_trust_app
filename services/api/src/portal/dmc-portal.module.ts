import {
  Body,
  ConflictException,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  HttpCode,
  Module,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  DmcListingInput,
  DmcSignupInput,
  QuoteRequestCreateInput,
  dmcListingSchema,
  dmcSignupSchema,
  famTripJoinSchema,
  quoteCloseSchema,
  quoteRequestCreateSchema,
} from '@ttp/shared-types';
import * as bcrypt from 'bcryptjs';
import { z } from 'zod';
import { PrismaService } from '../common/prisma.service';
import { RevalidationService } from '../common/revalidation.service';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { NotificationsService } from '../mail/notifications.service';
import { CurrentAccount, PortalAccount, PortalAuthGuard, PortalAuthService, PortalRoles } from './portal-auth';

/** The signed-in DMC; wholesale inventory and quotes need an approved company. */
function approvedDmc(a: PortalAccount) {
  if (!a.dmc) throw new ForbiddenException();
  if (a.dmc.status !== 'APPROVED') throw new ForbiddenException('Ваша компания ещё на проверке. Мы напишем, когда доступ откроется.');
  return a.dmc;
}

const SELLABLE = { status: 'PUBLISHED', operator: { status: 'APPROVED' } } satisfies Prisma.PackageWhereInput;
const operatorSummary = { select: { id: true, name: true, slug: true, countryCode: true, licensingAuthority: true, approvedAt: true, yearEstablished: true, responseTimeScore: true, status: true } } as const;

const inventoryQuery = z.object({
  country: z.string().trim().toUpperCase().regex(/^[A-Z]{2}$/).optional(),
  q: z.string().trim().min(1).max(100).optional(),
  maxDays: z.coerce.number().int().min(1).max(60).optional(),
  month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/).optional(),
});

/** Copy-ready Russian text a DMC can paste into its own site (white-label: no operator contacts). */
export function whiteLabelText(p: {
  title: string;
  titleRu: string | null;
  descriptionRu: string | null;
  durationDays: number;
  inclusions: string[];
  exclusions: string[];
  dateRanges: { startDate: Date; endDate: Date }[];
}, title?: string | null): string {
  const d = (x: Date) => x.toISOString().slice(0, 10).split('-').reverse().join('.');
  const facts = [
    p.inclusions.length ? `Включено: ${p.inclusions.join(', ')}` : '',
    p.exclusions.length ? `Не включено: ${p.exclusions.join(', ')}` : '',
    p.dateRanges.length ? `Даты: ${p.dateRanges.map((r) => `${d(r.startDate)}–${d(r.endDate)}`).join('; ')}` : '',
  ].filter(Boolean);
  // Paragraphs separated by a blank line; empty ones are left out.
  return [
    `${title ?? p.titleRu ?? p.title}\n${p.durationDays} дн.`,
    p.descriptionRu ?? '',
    facts.join('\n'),
    'Принимающая сторона проверена платформой «Проверено: Африка».',
  ]
    .filter(Boolean)
    .join('\n\n');
}

/** DMC side of the partner portal (spec B2B-2, B2B-3, B2B-4). Russian UI. */
@Controller('portal')
export class DmcPortalController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auth: PortalAuthService,
    private readonly revalidation: RevalidationService,
    private readonly notifications: NotificationsService,
  ) {}

  /** Russian DMCs apply here; staff check them before inventory opens. */
  @Post('dmc-signup')
  async signup(@Body(new ZodValidationPipe(dmcSignupSchema)) body: DmcSignupInput) {
    const { email, password, ...company } = body;
    if (await this.prisma.account.findUnique({ where: { email } })) throw new ConflictException('Этот email уже зарегистрирован. Войдите или восстановите пароль.');
    const dmc = await this.prisma.$transaction(async (tx) => {
      const created = await tx.dmc.create({ data: { ...company, email, countryCode: 'RU', status: 'PENDING' } });
      await tx.account.create({ data: { email, passwordHash: await bcrypt.hash(password, 12), role: 'DMC', dmcId: created.id } });
      return created;
    });
    this.notifications.dmcApplied(dmc);
    return this.auth.login({ email, password });
  }

  @Get('dmc/inventory')
  @UseGuards(PortalAuthGuard)
  @PortalRoles('DMC')
  async inventory(@Query(new ZodValidationPipe(inventoryQuery)) q: z.infer<typeof inventoryQuery>, @CurrentAccount() a: PortalAccount) {
    const dmc = approvedDmc(a);
    const monthStart = q.month ? new Date(`${q.month}-01T00:00:00Z`) : undefined;
    const monthEnd = monthStart ? new Date(Date.UTC(monthStart.getUTCFullYear(), monthStart.getUTCMonth() + 1, 0)) : undefined;
    const rows = await this.prisma.package.findMany({
      where: {
        ...SELLABLE,
        countryCode: q.country,
        ...(q.maxDays && { durationDays: { lte: q.maxDays } }),
        ...(q.q && { OR: [{ title: { contains: q.q, mode: 'insensitive' } }, { titleRu: { contains: q.q, mode: 'insensitive' } }, { operator: { name: { contains: q.q, mode: 'insensitive' } } }] }),
        ...(monthStart && { dateRanges: { some: { startDate: { lte: monthEnd }, endDate: { gte: monthStart } } } }),
      },
      include: {
        operator: operatorSummary,
        dateRanges: { where: { endDate: { gte: new Date() } }, orderBy: { startDate: 'asc' } },
        listings: { where: { dmcId: dmc.id }, select: { id: true, active: true } },
      },
      orderBy: [{ countryCode: 'asc' }, { title: 'asc' }],
      take: 200,
    });
    return rows.map(({ listings, ...p }) => ({ ...p, listedByMe: listings.length > 0 }));
  }

  @Post('dmc/quotes')
  @UseGuards(PortalAuthGuard)
  @PortalRoles('DMC')
  async requestQuote(@Body(new ZodValidationPipe(quoteRequestCreateSchema)) body: QuoteRequestCreateInput, @CurrentAccount() a: PortalAccount) {
    const dmc = approvedDmc(a);
    const pkg = await this.prisma.package.findFirst({ where: { id: body.packageId, ...SELLABLE } });
    if (!pkg) throw new NotFoundException('Тур не найден или снят с продажи');
    const open = await this.prisma.quoteRequest.count({ where: { dmcId: dmc.id, packageId: pkg.id, status: 'OPEN' } });
    if (open) throw new ConflictException('По этому туру уже есть открытый запрос. Дождитесь ответа.');
    const q = await this.prisma.quoteRequest.create({
      data: {
        dmcId: dmc.id,
        packageId: pkg.id,
        pax: body.pax,
        travelStartDate: new Date(`${body.travelStartDate}T00:00:00Z`),
        travelEndDate: body.travelEndDate ? new Date(`${body.travelEndDate}T00:00:00Z`) : undefined,
        notes: body.notes,
      },
    });
    await this.prisma.auditLog.create({ data: { actorAccountId: a.id, action: 'quote.request', entityType: 'quote_request', entityId: q.id } });
    this.notifications.quoteRequested(q.id);
    return q;
  }

  @Get('dmc/quotes')
  @UseGuards(PortalAuthGuard)
  @PortalRoles('DMC')
  quotes(@CurrentAccount() a: PortalAccount) {
    return this.prisma.quoteRequest.findMany({
      where: { dmcId: approvedDmc(a).id },
      include: { package: { select: { id: true, title: true, titleRu: true, slug: true, durationDays: true, operator: { select: { name: true, slug: true } } } } },
      orderBy: { createdAt: 'desc' },
    });
  }

  @Post('dmc/quotes/:id/close')
  @HttpCode(200)
  @UseGuards(PortalAuthGuard)
  @PortalRoles('DMC')
  async closeQuote(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodValidationPipe(quoteCloseSchema)) body: z.infer<typeof quoteCloseSchema>, @CurrentAccount() a: PortalAccount) {
    const dmc = approvedDmc(a);
    const { count } = await this.prisma.quoteRequest.updateMany({ where: { id, dmcId: dmc.id, status: { in: ['OPEN', 'QUOTED'] } }, data: { status: 'CLOSED', closedAt: new Date() } });
    if (count === 0) throw new ConflictException('Запрос не найден или уже закрыт');
    await this.prisma.auditLog.create({ data: { actorAccountId: a.id, action: 'quote.close', entityType: 'quote_request', entityId: id, reason: body.note, metadata: { outcome: body.outcome } } });
    return { ok: true };
  }

  // ── Listings under the DMC's own brand (white-label) and mirror pages ────

  @Get('dmc/listings')
  @UseGuards(PortalAuthGuard)
  @PortalRoles('DMC')
  async listings(@CurrentAccount() a: PortalAccount) {
    const rows = await this.prisma.dmcPackageListing.findMany({
      where: { dmcId: approvedDmc(a).id },
      include: { package: { include: { operator: operatorSummary, dateRanges: { where: { endDate: { gte: new Date() } }, orderBy: { startDate: 'asc' } } } } },
      orderBy: { createdAt: 'desc' },
    });
    const site = (process.env.SITE_URL ?? 'http://localhost:3001').replace(/\/$/, '');
    return rows.map((l) => ({
      ...l,
      sellable: l.package.status === 'PUBLISHED' && l.package.operator.status === 'APPROVED',
      mirrorUrl: `${site}/tours/${l.package.slug}`,
      whiteLabelText: whiteLabelText(l.package, l.whiteLabelTitle),
    }));
  }

  /** Add or update a listing. Active listings with a page URL appear on the public tour page as "where to buy". */
  @Post('dmc/listings')
  @UseGuards(PortalAuthGuard)
  @PortalRoles('DMC')
  async upsertListing(@Body(new ZodValidationPipe(dmcListingSchema)) body: DmcListingInput, @CurrentAccount() a: PortalAccount) {
    const dmc = approvedDmc(a);
    const pkg = await this.prisma.package.findFirst({ where: { id: body.packageId, ...SELLABLE } });
    if (!pkg) throw new NotFoundException('Тур не найден или снят с продажи');
    const data = { whiteLabelTitle: body.whiteLabelTitle ?? null, dmcPageUrl: body.dmcPageUrl ?? null, active: body.active };
    const listing = await this.prisma.dmcPackageListing.upsert({
      where: { dmcId_packageId: { dmcId: dmc.id, packageId: pkg.id } },
      create: { dmcId: dmc.id, packageId: pkg.id, ...data },
      update: data,
    });
    this.revalidation.revalidate('operators');
    return listing;
  }

  @Delete('dmc/listings/:id')
  @UseGuards(PortalAuthGuard)
  @PortalRoles('DMC')
  async removeListing(@Param('id', ParseUUIDPipe) id: string, @CurrentAccount() a: PortalAccount) {
    const { count } = await this.prisma.dmcPackageListing.deleteMany({ where: { id, dmcId: approvedDmc(a).id } });
    if (count === 0) throw new NotFoundException('Listing not found');
    this.revalidation.revalidate('operators');
    return { ok: true };
  }

  // ── Fam trips (B2B-3) ─────────────────────────────────────────────────────

  @Get('dmc/fam-trips')
  @UseGuards(PortalAuthGuard)
  @PortalRoles('DMC')
  async famTrips(@CurrentAccount() a: PortalAccount) {
    const dmc = approvedDmc(a);
    const trips = await this.prisma.famTrip.findMany({
      where: { status: { in: ['PLANNED', 'CONFIRMED'] }, endDate: { gte: new Date() } },
      include: {
        operators: { include: { operator: { select: { name: true, slug: true, countryCode: true } } } },
        dmcs: { select: { dmcId: true, confirmed: true, representativeName: true } },
      },
      orderBy: { startDate: 'asc' },
    });
    return trips.map(({ dmcs, ...t }) => {
      const mine = dmcs.find((d) => d.dmcId === dmc.id);
      return { ...t, seatsTaken: dmcs.filter((d) => d.confirmed).length, myStatus: mine ? (mine.confirmed ? 'confirmed' : 'requested') : null, myRepresentative: mine?.representativeName ?? null };
    });
  }

  @Post('dmc/fam-trips/:id/join')
  @HttpCode(200)
  @UseGuards(PortalAuthGuard)
  @PortalRoles('DMC')
  async joinFamTrip(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodValidationPipe(famTripJoinSchema)) body: { representativeName: string }, @CurrentAccount() a: PortalAccount) {
    const dmc = approvedDmc(a);
    const trip = await this.prisma.famTrip.findFirst({ where: { id, status: { in: ['PLANNED', 'CONFIRMED'] }, endDate: { gte: new Date() } } });
    if (!trip) throw new NotFoundException('Поездка не найдена или уже прошла');
    try {
      await this.prisma.famTripDmc.create({ data: { famTripId: id, dmcId: dmc.id, representativeName: body.representativeName, confirmed: false } });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') throw new ConflictException('Вы уже подали заявку на эту поездку');
      throw e;
    }
    await this.prisma.auditLog.create({ data: { actorAccountId: a.id, action: 'fam_trip.dmc_request', entityType: 'fam_trip', entityId: id } });
    this.notifications.famTripRequested(id, dmc.id, body.representativeName);
    return { ok: true };
  }
}

@Module({ controllers: [DmcPortalController] })
export class DmcPortalModule {}
