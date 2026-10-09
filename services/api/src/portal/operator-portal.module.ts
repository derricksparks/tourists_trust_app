import {
  Body,
  ConflictException,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  Module,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { PackageStatus } from '@prisma/client';
import { PackageInput, QuoteResponseInput, packageCreateSchema, packageStatusSchema, quoteResponseSchema } from '@ttp/shared-types';
import { PrismaService } from '../common/prisma.service';
import { RevalidationService } from '../common/revalidation.service';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { ScoringService } from '../scoring/scoring.service';
import { packageData, packageInclude, uniquePackageSlug } from './packages';
import { CurrentAccount, PortalAccount, PortalAuthGuard, PortalRoles } from './portal-auth';

/** The signed-in operator; edits need an approved operator (a suspended one can still look). */
function operatorOf(a: PortalAccount, forWrite = false) {
  if (!a.operator) throw new ForbiddenException();
  if (forWrite && a.operator.status !== 'APPROVED') throw new ForbiddenException('Your listing is not active, so changes are paused. Contact us.');
  return a.operator;
}

/** Operator side of the partner portal (spec DI-2, B2B-1, B2B-2, B2B-3). English UI. */
@Controller('portal/operator')
@UseGuards(PortalAuthGuard)
@PortalRoles('OPERATOR')
export class OperatorPortalController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scoring: ScoringService,
    private readonly revalidation: RevalidationService,
  ) {}

  @Get('overview')
  async overview(@CurrentAccount() a: PortalAccount) {
    const op = operatorOf(a);
    const [scores, openQuotes, packages, famTrips] = await Promise.all([
      this.scoring.breakdown(op.id),
      this.prisma.quoteRequest.count({ where: { status: 'OPEN', package: { operatorId: op.id } } }),
      this.prisma.package.groupBy({ by: ['status'], where: { operatorId: op.id }, _count: { _all: true }, orderBy: { status: 'asc' } }),
      this.prisma.famTripOperator.count({ where: { operatorId: op.id, famTrip: { endDate: { gte: new Date() }, status: { in: ['PLANNED', 'CONFIRMED'] } } } }),
    ]);
    return {
      operator: { id: op.id, name: op.name, slug: op.slug, status: op.status, statusReason: op.status === 'APPROVED' ? null : op.statusReason },
      scores,
      openQuotes,
      packagesByStatus: Object.fromEntries(packages.map((p) => [p.status, (p._count as { _all: number })._all])),
      upcomingFamTrips: famTrips,
    };
  }

  // ── Packages (B2B-1, form-based feed) ─────────────────────────────────────

  @Get('packages')
  packages(@CurrentAccount() a: PortalAccount) {
    return this.prisma.package.findMany({ where: { operatorId: operatorOf(a).id }, include: packageInclude, orderBy: [{ status: 'asc' }, { title: 'asc' }] });
  }

  @Get('packages/:id')
  async package(@Param('id', ParseUUIDPipe) id: string, @CurrentAccount() a: PortalAccount) {
    const p = await this.prisma.package.findFirst({ where: { id, operatorId: operatorOf(a).id }, include: packageInclude });
    if (!p) throw new NotFoundException('Tour not found');
    return p;
  }

  @Post('packages')
  async create(@Body(new ZodValidationPipe(packageCreateSchema)) body: PackageInput, @CurrentAccount() a: PortalAccount) {
    const op = operatorOf(a, true);
    const created = await this.prisma.$transaction(async (tx) => {
      const p = await tx.package.create({
        data: { ...packageData(body), operatorId: op.id, slug: await uniquePackageSlug(tx, body.title, op.slug), status: 'DRAFT' },
        include: packageInclude,
      });
      await tx.auditLog.create({ data: { actorAccountId: a.id, action: 'package.create', entityType: 'package', entityId: p.id } });
      return p;
    });
    return created;
  }

  @Patch('packages/:id')
  async update(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodValidationPipe(packageCreateSchema)) body: PackageInput, @CurrentAccount() a: PortalAccount) {
    const op = operatorOf(a, true);
    const updated = await this.prisma.$transaction(async (tx) => {
      const existing = await tx.package.findFirst({ where: { id, operatorId: op.id } });
      if (!existing) throw new NotFoundException('Tour not found');
      await tx.packageDateRange.deleteMany({ where: { packageId: id } });
      const p = await tx.package.update({ where: { id }, data: packageData(body), include: packageInclude });
      await tx.auditLog.create({ data: { actorAccountId: a.id, action: 'package.update', entityType: 'package', entityId: id } });
      return p;
    });
    await this.afterChange(op.id, updated.status);
    return updated;
  }

  /** Publish, unpublish (back to draft) or archive. Operators are vetted, so publishing needs no review. */
  @Post('packages/:id/status')
  @HttpCode(200)
  async setStatus(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodValidationPipe(packageStatusSchema)) body: { status: PackageStatus }, @CurrentAccount() a: PortalAccount) {
    const op = operatorOf(a, true);
    const p = await this.prisma.package.findFirst({ where: { id, operatorId: op.id }, include: { dateRanges: true } });
    if (!p) throw new NotFoundException('Tour not found');
    if (body.status === 'PUBLISHED' && !p.descriptionRu) throw new ConflictException('Add a Russian description before publishing: Russian travellers and DMCs read it.');
    const updated = await this.prisma.package.update({ where: { id }, data: { status: body.status }, include: packageInclude });
    await this.prisma.auditLog.create({ data: { actorAccountId: a.id, action: `package.${body.status.toLowerCase()}`, entityType: 'package', entityId: id } });
    await this.afterChange(op.id, 'PUBLISHED');
    return updated;
  }

  // ── Quote requests from DMCs (B2B-2) ──────────────────────────────────────

  @Get('quotes')
  quotes(@CurrentAccount() a: PortalAccount) {
    return this.prisma.quoteRequest.findMany({
      where: { package: { operatorId: operatorOf(a).id } },
      include: { package: { select: { id: true, title: true, durationDays: true } }, dmc: { select: { name: true, websiteUrl: true, contactName: true, email: true, phone: true } } },
      orderBy: [{ status: 'asc' }, { createdAt: 'asc' }],
    });
  }

  @Post('quotes/:id/respond')
  @HttpCode(200)
  async respond(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodValidationPipe(quoteResponseSchema)) body: QuoteResponseInput, @CurrentAccount() a: PortalAccount) {
    const op = operatorOf(a, true);
    const quote = await this.prisma.quoteRequest.findFirst({ where: { id, package: { operatorId: op.id } } });
    if (!quote) throw new NotFoundException('Quote request not found');
    const now = new Date();
    const data =
      body.action === 'quote'
        ? { status: 'QUOTED' as const, quotedPrice: body.quotedPrice, quotedCurrency: body.quotedCurrency, quoteTerms: body.quoteTerms, quotedAt: now }
        : { status: 'CLOSED' as const, closedAt: now };
    const { count } = await this.prisma.quoteRequest.updateMany({ where: { id, status: 'OPEN' }, data });
    if (count === 0) throw new ConflictException('This request has already been answered or closed');
    await this.prisma.auditLog.create({
      data: { actorAccountId: a.id, action: `quote.${body.action}`, entityType: 'quote_request', entityId: id, reason: body.action === 'decline' ? body.reason : undefined },
    });
    await this.scoring.recompute(op.id);
    return this.prisma.quoteRequest.findUniqueOrThrow({ where: { id } });
  }

  // ── Fam trips (B2B-3) ─────────────────────────────────────────────────────

  @Get('fam-trips')
  famTrips(@CurrentAccount() a: PortalAccount) {
    return this.prisma.famTripOperator.findMany({
      where: { operatorId: operatorOf(a).id },
      include: { famTrip: { include: { dmcs: { where: { confirmed: true }, include: { dmc: { select: { name: true } } } } } } },
      orderBy: { famTrip: { startDate: 'asc' } },
    });
  }

  @Post('fam-trips/:id/confirm')
  @HttpCode(200)
  async confirmFamTrip(@Param('id', ParseUUIDPipe) famTripId: string, @CurrentAccount() a: PortalAccount) {
    const op = operatorOf(a, true);
    const { count } = await this.prisma.famTripOperator.updateMany({ where: { famTripId, operatorId: op.id }, data: { confirmed: true } });
    if (count === 0) throw new NotFoundException('You are not part of this fam trip');
    await this.prisma.auditLog.create({ data: { actorAccountId: a.id, action: 'fam_trip.operator_confirm', entityType: 'fam_trip', entityId: famTripId } });
    return { ok: true };
  }

  private async afterChange(operatorId: string, status: PackageStatus) {
    await this.scoring.recompute(operatorId);
    if (status === 'PUBLISHED') this.revalidation.revalidate('operators');
  }
}

@Module({ controllers: [OperatorPortalController] })
export class OperatorPortalModule {}
