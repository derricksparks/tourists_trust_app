import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Delete,
  Get,
  HttpCode,
  Module,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { Account, AdminUser, Prisma } from '@prisma/client';
import {
  DMC_STATUSES,
  DMC_TRANSITIONS,
  DmcDecisionInput,
  FamTripInput,
  FamTripParticipantInput,
  PublicPackageDetail,
  QUOTE_STATUSES,
  dmcDecisionSchema,
  famTripParticipantSchema,
  famTripSchema,
  portalAccountCreateSchema,
} from '@ttp/shared-types';
import { z } from 'zod';
import { AdminAuthGuard, AdminRoles, CurrentAdmin } from '../admin-auth/admin-auth.guard';
import { PrismaService } from '../common/prisma.service';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { MailService } from '../mail/mail.service';
import { NotificationsService } from '../mail/notifications.service';
import { ScoringService } from '../scoring/scoring.service';
import { PortalAuthService, unusablePasswordHash } from './portal-auth';

const day = (d: string) => new Date(`${d}T00:00:00Z`);
const accountSelect = { id: true, email: true, role: true, active: true, lastLoginAt: true, createdAt: true } as const;

/** Staff tools for the B2B layer: DMC checks, partner logins, quotes overview, fam trips. */
@Controller('admin')
@UseGuards(AdminAuthGuard)
export class AdminB2bController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly portalAuth: PortalAuthService,
    private readonly scoring: ScoringService,
    private readonly mail: MailService,
    private readonly notifications: NotificationsService,
  ) {}

  /** Emails a set-password link when email is set up; the link is returned either way so staff can pass it on. */
  private async sendLink(account: Account, kind: 'new' | 'reset') {
    const link = await this.portalAuth.setPasswordLink(account);
    try {
      await this.notifications.passwordLink(account, link, kind);
      return { link, emailed: this.mail.configured };
    } catch (e) {
      return { link, emailed: false, emailError: (e as Error).message };
    }
  }

  // ── DMCs ──────────────────────────────────────────────────────────────────

  @Get('dmcs')
  dmcs(@Query(new ZodValidationPipe(z.object({ status: z.enum(DMC_STATUSES).optional() }))) q: { status?: (typeof DMC_STATUSES)[number] }) {
    return this.prisma.dmc.findMany({
      where: { status: q.status },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      include: { accounts: { select: accountSelect }, _count: { select: { quoteRequests: true, listings: true } } },
    });
  }

  @Post('dmcs/:id/decision')
  @HttpCode(200)
  @AdminRoles('SUPER_ADMIN', 'MODERATOR')
  async decideDmc(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodValidationPipe(dmcDecisionSchema)) body: DmcDecisionInput, @CurrentAdmin() admin: AdminUser) {
    const { from, to } = DMC_TRANSITIONS[body.decision];
    const { count } = await this.prisma.dmc.updateMany({ where: { id, status: { in: [...from] } }, data: { status: to, statusReason: body.decision === 'approve' ? null : body.reason } });
    if (count === 0) {
      const current = await this.prisma.dmc.findUnique({ where: { id } });
      if (!current) throw new NotFoundException('DMC not found');
      throw new ConflictException(`Cannot ${body.decision} a DMC whose status is ${current.status}`);
    }
    await this.prisma.auditLog.create({ data: { actorAdminId: admin.id, action: `dmc.${body.decision}`, entityType: 'dmc', entityId: id, reason: body.reason, metadata: { to } } });
    this.notifications.dmcDecided(id, body.decision, body.reason);
    return this.prisma.dmc.findUniqueOrThrow({ where: { id }, include: { accounts: { select: accountSelect }, _count: { select: { quoteRequests: true, listings: true } } } });
  }

  // ── Partner portal logins ─────────────────────────────────────────────────

  @Get('operators/:id/accounts')
  operatorAccounts(@Param('id', ParseUUIDPipe) id: string) {
    return this.prisma.account.findMany({ where: { operatorId: id }, select: accountSelect, orderBy: { createdAt: 'asc' } });
  }

  /** Creates a login for an operator's staff and emails them a one-time set-password link (also returned). */
  @Post('operators/:id/accounts')
  @AdminRoles('SUPER_ADMIN', 'MODERATOR')
  async createOperatorAccount(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodValidationPipe(portalAccountCreateSchema)) body: { email: string }, @CurrentAdmin() admin: AdminUser) {
    const op = await this.prisma.operator.findUnique({ where: { id } });
    if (!op) throw new NotFoundException('Operator not found');
    if (op.status !== 'APPROVED') throw new ConflictException('Only approved operators get portal access');
    if (await this.prisma.account.findUnique({ where: { email: body.email } })) throw new ConflictException('That email already has a login');
    const account = await this.prisma.account.create({ data: { email: body.email, passwordHash: unusablePasswordHash(), role: 'OPERATOR', operatorId: id } });
    await this.prisma.auditLog.create({ data: { actorAdminId: admin.id, action: 'account.create', entityType: 'account', entityId: account.id, metadata: { operatorId: id } } });
    return { account: { id: account.id, email: account.email, role: account.role, active: account.active }, ...(await this.sendLink(account, 'new')) };
  }

  /** New one-time link (forgotten password). Older links stop working only once a password is set. */
  @Post('accounts/:id/password-link')
  @HttpCode(200)
  @AdminRoles('SUPER_ADMIN', 'MODERATOR')
  async passwordLink(@Param('id', ParseUUIDPipe) id: string, @CurrentAdmin() admin: AdminUser) {
    const account = await this.prisma.account.findUnique({ where: { id } });
    if (!account || !account.active) throw new NotFoundException('Active login not found');
    await this.prisma.auditLog.create({ data: { actorAdminId: admin.id, action: 'account.password_link', entityType: 'account', entityId: id } });
    return this.sendLink(account, 'reset');
  }

  @Post('accounts/:id/active')
  @HttpCode(200)
  @AdminRoles('SUPER_ADMIN', 'MODERATOR')
  async setActive(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodValidationPipe(z.object({ active: z.boolean() }))) body: { active: boolean }, @CurrentAdmin() admin: AdminUser) {
    const account = await this.prisma.account.update({ where: { id }, data: { active: body.active }, select: accountSelect }).catch(() => {
      throw new NotFoundException('Login not found');
    });
    await this.prisma.auditLog.create({ data: { actorAdminId: admin.id, action: body.active ? 'account.activate' : 'account.deactivate', entityType: 'account', entityId: id } });
    return account;
  }

  // ── Quotes overview ───────────────────────────────────────────────────────

  @Get('quotes')
  quotes(@Query(new ZodValidationPipe(z.object({ status: z.enum(QUOTE_STATUSES).optional() }))) q: { status?: (typeof QUOTE_STATUSES)[number] }) {
    return this.prisma.quoteRequest.findMany({
      where: { status: q.status },
      include: { dmc: { select: { id: true, name: true } }, package: { select: { id: true, title: true, operator: { select: { id: true, name: true, email: true, phone: true } } } } },
      orderBy: { createdAt: 'asc' },
      take: 200,
    });
  }

  // ── Operator scores ───────────────────────────────────────────────────────

  @Get('operators/:id/scores')
  scores(@Param('id', ParseUUIDPipe) id: string) {
    return this.scoring.breakdown(id);
  }

  @Post('scores/recompute')
  @HttpCode(200)
  @AdminRoles('SUPER_ADMIN')
  async recomputeAll() {
    return { operators: await this.scoring.recomputeAll() };
  }

  // ── Fam trips (B2B-3) ─────────────────────────────────────────────────────

  @Get('fam-trips')
  famTrips() {
    return this.prisma.famTrip.findMany({
      include: { _count: { select: { dmcs: true, operators: true } }, dmcs: { select: { confirmed: true } } },
      orderBy: { startDate: 'desc' },
    });
  }

  @Get('fam-trips/:id')
  async famTrip(@Param('id', ParseUUIDPipe) id: string) {
    const t = await this.prisma.famTrip.findUnique({
      where: { id },
      include: {
        dmcs: { include: { dmc: { select: { id: true, name: true, status: true, contactName: true, email: true, phone: true } } } },
        operators: { include: { operator: { select: { id: true, name: true, countryCode: true, email: true, phone: true } } } },
      },
    });
    if (!t) throw new NotFoundException('Fam trip not found');
    return t;
  }

  @Post('fam-trips')
  @AdminRoles('SUPER_ADMIN', 'MODERATOR')
  async createFamTrip(@Body(new ZodValidationPipe(famTripSchema)) body: FamTripInput, @CurrentAdmin() admin: AdminUser) {
    const t = await this.prisma.famTrip.create({ data: { ...body, startDate: day(body.startDate), endDate: day(body.endDate) } });
    await this.prisma.auditLog.create({ data: { actorAdminId: admin.id, action: 'fam_trip.create', entityType: 'fam_trip', entityId: t.id } });
    return t;
  }

  @Patch('fam-trips/:id')
  @AdminRoles('SUPER_ADMIN', 'MODERATOR')
  async updateFamTrip(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodValidationPipe(famTripSchema)) body: FamTripInput, @CurrentAdmin() admin: AdminUser) {
    const t = await this.prisma.famTrip.update({ where: { id }, data: { ...body, startDate: day(body.startDate), endDate: day(body.endDate) } }).catch(() => {
      throw new NotFoundException('Fam trip not found');
    });
    await this.prisma.auditLog.create({ data: { actorAdminId: admin.id, action: 'fam_trip.update', entityType: 'fam_trip', entityId: id } });
    return t;
  }

  /** Add a participant or update one (confirm, representative, role). */
  @Post('fam-trips/:id/participants')
  @HttpCode(200)
  @AdminRoles('SUPER_ADMIN', 'MODERATOR')
  async upsertParticipant(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodValidationPipe(famTripParticipantSchema)) body: FamTripParticipantInput, @CurrentAdmin() admin: AdminUser) {
    const trip = await this.prisma.famTrip.findUnique({ where: { id }, include: { dmcs: true, operators: true } });
    if (!trip) throw new NotFoundException('Fam trip not found');
    try {
      if (body.kind === 'dmc') {
        const confirmedOthers = trip.dmcs.filter((d) => d.confirmed && d.dmcId !== body.id).length;
        if (body.confirmed && trip.capacity && confirmedOthers >= trip.capacity) throw new ConflictException(`The trip is full (${trip.capacity} places)`);
        await this.prisma.famTripDmc.upsert({
          where: { famTripId_dmcId: { famTripId: id, dmcId: body.id } },
          create: { famTripId: id, dmcId: body.id, representativeName: body.representativeName ?? null, confirmed: body.confirmed },
          update: { confirmed: body.confirmed, ...(body.representativeName !== undefined && { representativeName: body.representativeName }) },
        });
      } else {
        await this.prisma.famTripOperator.upsert({
          where: { famTripId_operatorId: { famTripId: id, operatorId: body.id } },
          create: { famTripId: id, operatorId: body.id, role: body.role ?? null, confirmed: body.confirmed },
          update: { confirmed: body.confirmed, ...(body.role !== undefined && { role: body.role }) },
        });
      }
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2003') throw new BadRequestException(`Unknown ${body.kind}`);
      throw e;
    }
    if (body.kind === 'dmc' && body.confirmed && !trip.dmcs.find((d) => d.dmcId === body.id)?.confirmed) this.notifications.famTripDmcConfirmed(id, body.id);
    if (body.kind === 'operator' && !trip.operators.some((o) => o.operatorId === body.id)) this.notifications.famTripOperatorAdded(id, body.id);
    await this.prisma.auditLog.create({ data: { actorAdminId: admin.id, action: 'fam_trip.participant', entityType: 'fam_trip', entityId: id, metadata: { kind: body.kind, id: body.id, confirmed: body.confirmed } } });
    return this.famTrip(id);
  }

  @Delete('fam-trips/:id/participants/:kind/:participantId')
  @AdminRoles('SUPER_ADMIN', 'MODERATOR')
  async removeParticipant(@Param('id', ParseUUIDPipe) id: string, @Param('kind') kind: string, @Param('participantId', ParseUUIDPipe) participantId: string, @CurrentAdmin() admin: AdminUser) {
    if (kind === 'dmc') await this.prisma.famTripDmc.deleteMany({ where: { famTripId: id, dmcId: participantId } });
    else if (kind === 'operator') await this.prisma.famTripOperator.deleteMany({ where: { famTripId: id, operatorId: participantId } });
    else throw new BadRequestException('kind must be dmc or operator');
    await this.prisma.auditLog.create({ data: { actorAdminId: admin.id, action: 'fam_trip.remove_participant', entityType: 'fam_trip', entityId: id, metadata: { kind, id: participantId } } });
    return this.famTrip(id);
  }
}

/** Public mirror page of a tour (B2B-4). */
@Controller('public/packages')
export class PublicPackagesController {
  constructor(private readonly prisma: PrismaService) {}

  @Get(':slug')
  async package(@Param('slug') slug: string): Promise<PublicPackageDetail> {
    const today = new Date(new Date().toISOString().slice(0, 10));
    const p = await this.prisma.package.findFirst({
      where: { slug, status: 'PUBLISHED', operator: { status: 'APPROVED' } },
      include: {
        operator: true,
        dateRanges: { where: { endDate: { gte: today } }, orderBy: { startDate: 'asc' } },
        listings: { where: { active: true, dmcPageUrl: { not: null }, dmc: { status: 'APPROVED' } }, include: { dmc: { select: { name: true } } } },
      },
    });
    if (!p) throw new NotFoundException('Tour not found');
    const reviews = await this.prisma.review.aggregate({ where: { operatorId: p.operatorId, status: 'PUBLISHED' }, _count: { _all: true }, _avg: { rating: true } });
    const packageCount = await this.prisma.package.count({ where: { operatorId: p.operatorId, status: 'PUBLISHED' } });
    const o = p.operator;
    return {
      slug: p.slug,
      title: p.title,
      titleRu: p.titleRu,
      descriptionRu: p.descriptionRu,
      durationDays: p.durationDays,
      price: p.price?.toString() ?? null,
      currency: p.currency,
      priceBasis: p.priceBasis,
      capacity: p.capacity,
      inclusions: p.inclusions,
      exclusions: p.exclusions,
      dates: p.dateRanges.map((d) => ({ startDate: d.startDate.toISOString().slice(0, 10), endDate: d.endDate.toISOString().slice(0, 10), capacity: d.capacity })),
      operator: {
        slug: o.slug,
        name: o.name,
        countryCode: o.countryCode,
        licensingAuthority: o.licensingAuthority,
        yearEstablished: o.yearEstablished,
        descriptionRu: o.descriptionRu,
        verifiedSince: o.approvedAt?.toISOString() ?? null,
        reviewCount: reviews._count._all,
        averageRating: reviews._avg.rating === null ? null : Math.round(reviews._avg.rating * 10) / 10,
        packageCount,
        websiteUrl: o.websiteUrl,
      },
      sellers: p.listings.map((l) => ({ dmcName: l.dmc.name, title: l.whiteLabelTitle ?? p.titleRu ?? p.title, url: l.dmcPageUrl! })),
    };
  }
}

@Module({ controllers: [AdminB2bController, PublicPackagesController] })
export class AdminB2bModule {}

