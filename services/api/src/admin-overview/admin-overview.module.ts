import { Body, ConflictException, Controller, Get, Module, NotFoundException, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  AdminCountry,
  AdminStats,
  CountryCreateInput,
  CountryUpdateInput,
  OPERATOR_STATUSES,
  OperatorStatus,
  countryCreateSchema,
  countryUpdateSchema,
} from '@ttp/shared-types';
import { AdminAuthGuard, AdminRoles } from '../admin-auth/admin-auth.guard';
import { PrismaService } from '../common/prisma.service';
import { RevalidationService } from '../common/revalidation.service';
import { ZodValidationPipe } from '../common/zod-validation.pipe';

/** Dashboard numbers (spec AD-2). */
@Controller('admin')
@UseGuards(AdminAuthGuard)
export class AdminOverviewController {
  constructor(private readonly prisma: PrismaService) {}

  @Get('stats')
  async stats(): Promise<AdminStats> {
    const [byStatus, reviewsPending, inquiriesNew, translatorsPending, translationJobsOpen, dmcsPending, quotesUnanswered48h, listingsLive, dmcsOnboarded, quoteRequests, translatorJobsCompleted] =
      await this.prisma.$transaction([
        this.prisma.operator.groupBy({ by: ['status'], _count: { _all: true }, orderBy: { status: 'asc' } }),
        this.prisma.review.count({ where: { status: 'PENDING' } }),
        this.prisma.inquiry.count({ where: { status: 'NEW' } }),
        this.prisma.translator.count({ where: { verificationStatus: 'PENDING' } }),
        this.prisma.translationJob.count({ where: { status: 'REQUESTED' } }),
        this.prisma.dmc.count({ where: { status: 'PENDING' } }),
        this.prisma.quoteRequest.count({ where: { status: 'OPEN', createdAt: { lt: new Date(Date.now() - 48 * 3600 * 1000) } } }),
        this.prisma.package.count({ where: { status: 'PUBLISHED', operator: { status: 'APPROVED' } } }),
        this.prisma.dmc.count({ where: { status: 'APPROVED' } }),
        this.prisma.quoteRequest.count(),
        this.prisma.translationJob.count({ where: { status: 'COMPLETED' } }),
      ]);
    const operatorsByStatus = Object.fromEntries(OPERATOR_STATUSES.map((s) => [s, 0])) as Record<OperatorStatus, number>;
    for (const row of byStatus) {
      operatorsByStatus[row.status] = (row._count as { _all: number })._all;
    }
    return {
      operatorsByStatus,
      reviewsPending,
      inquiriesNew,
      translatorsPending,
      translationJobsOpen,
      dmcsPending,
      quotesUnanswered48h,
      listingsLive,
      dmcsOnboarded,
      quoteRequests,
      translatorJobsCompleted,
    };
  }

}

const countryView = { code: true, nameEn: true, nameRu: true, nameRuIn: true, active: true, licensingAuthority: true, licenceRegisterUrl: true, _count: { select: { operators: true } } } as const;
const toAdminCountry = ({ _count, ...c }: Prisma.CountryGetPayload<{ select: typeof countryView }>): AdminCountry => ({ ...c, operatorCount: _count.operators });

/**
 * Countries (Phase 4, "more countries"): staff add a destination, fill in its licensing authority
 * and register link, and switch it on when ready. Only super admins change them. Not in the audit
 * log, whose entity ids are UUIDs (countries are keyed by ISO code).
 */
@Controller('admin/countries')
@UseGuards(AdminAuthGuard)
export class AdminCountriesController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly revalidation: RevalidationService,
  ) {}

  @Get()
  async list(): Promise<AdminCountry[]> {
    return (await this.prisma.country.findMany({ select: countryView, orderBy: [{ active: 'desc' }, { nameEn: 'asc' }] })).map(toAdminCountry);
  }

  @Post()
  @AdminRoles('SUPER_ADMIN')
  async create(@Body(new ZodValidationPipe(countryCreateSchema)) body: CountryCreateInput): Promise<AdminCountry> {
    if (await this.prisma.country.findUnique({ where: { code: body.code } })) throw new ConflictException(`${body.code} is already in the list`);
    const c = await this.prisma.country.create({ data: body, select: countryView });
    if (body.active) this.revalidation.revalidate('operators');
    return toAdminCountry(c);
  }

  @Patch(':code')
  @AdminRoles('SUPER_ADMIN')
  async update(@Param('code') code: string, @Body(new ZodValidationPipe(countryUpdateSchema)) body: CountryUpdateInput): Promise<AdminCountry> {
    const c = await this.prisma.country.update({ where: { code: code.toUpperCase() }, data: body, select: countryView }).catch(() => {
      throw new NotFoundException('Country not found');
    });
    this.revalidation.revalidate('operators');
    return toAdminCountry(c);
  }
}

@Module({ controllers: [AdminOverviewController, AdminCountriesController] })
export class AdminOverviewModule {}
