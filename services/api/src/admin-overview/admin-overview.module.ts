import { Controller, Get, Module, UseGuards } from '@nestjs/common';
import { AdminStats, CountryOption, OPERATOR_STATUSES, OperatorStatus } from '@ttp/shared-types';
import { AdminAuthGuard } from '../admin-auth/admin-auth.guard';
import { PrismaService } from '../common/prisma.service';

/** Dashboard numbers (spec AD-2) and reference data for admin forms. */
@Controller('admin')
@UseGuards(AdminAuthGuard)
export class AdminOverviewController {
  constructor(private readonly prisma: PrismaService) {}

  @Get('stats')
  async stats(): Promise<AdminStats> {
    const [byStatus, reviewsPending, inquiriesNew, translatorsPending, translationJobsOpen, listingsLive, dmcsOnboarded, quoteRequests, translatorJobsCompleted] =
      await this.prisma.$transaction([
        this.prisma.operator.groupBy({ by: ['status'], _count: { _all: true }, orderBy: { status: 'asc' } }),
        this.prisma.review.count({ where: { status: 'PENDING' } }),
        this.prisma.inquiry.count({ where: { status: 'NEW' } }),
        this.prisma.translator.count({ where: { verificationStatus: 'PENDING' } }),
        this.prisma.translationJob.count({ where: { status: 'REQUESTED' } }),
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
      listingsLive, dmcsOnboarded, quoteRequests, translatorJobsCompleted };
  }

  @Get('countries')
  countries(): Promise<CountryOption[]> {
    return this.prisma.country.findMany({ orderBy: { nameEn: 'asc' } });
  }
}

@Module({ controllers: [AdminOverviewController] })
export class AdminOverviewModule {}
