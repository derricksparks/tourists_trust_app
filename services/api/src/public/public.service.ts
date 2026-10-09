import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  BadgeStatus,
  ChecklistItem,
  PublicCountry,
  PublicDestinationGuide,
  PublicOperatorDetail,
  PublicOperatorSummary,
  PublicVisaGuide,
} from '@ttp/shared-types';
import { PrismaService } from '../common/prisma.service';

const LISTED = { status: 'APPROVED' } satisfies Prisma.OperatorWhereInput;

const iso = (d: Date | null) => (d ? d.toISOString() : null);
const isoDate = (d: Date) => d.toISOString().slice(0, 10);

/**
 * Read-only data for the public site, the Telegram bot and the Mini App.
 * Only approved operators, published packages/reviews and published guides are ever returned,
 * and internal fields (status reasons, reference contacts, documents, badge tokens) never are.
 */
@Injectable()
export class PublicService {
  constructor(private readonly prisma: PrismaService) {}

  async countries(): Promise<PublicCountry[]> {
    const [countries, counts] = await Promise.all([
      this.prisma.country.findMany({ where: { code: { not: 'RU' } }, orderBy: { nameRu: 'asc' } }),
      this.prisma.operator.groupBy({ by: ['countryCode'], where: LISTED, _count: { _all: true } }),
    ]);
    const byCode = new Map(counts.map((c) => [c.countryCode, c._count._all]));
    return countries.map((c) => ({ ...c, operatorCount: byCode.get(c.code) ?? 0 }));
  }

  async operators(params: { countryCode?: string; q?: string }): Promise<PublicOperatorSummary[]> {
    const operators = await this.prisma.operator.findMany({
      where: {
        ...LISTED,
        countryCode: params.countryCode,
        ...(params.q && { name: { contains: params.q, mode: 'insensitive' } }),
      },
      orderBy: { name: 'asc' },
      take: 200,
      include: { _count: { select: { packages: { where: { status: 'PUBLISHED' } } } } },
    });
    const ratings = await this.ratings(operators.map((o) => o.id));
    return operators.map((o) => ({
      slug: o.slug,
      name: o.name,
      countryCode: o.countryCode,
      licensingAuthority: o.licensingAuthority,
      yearEstablished: o.yearEstablished,
      descriptionRu: o.descriptionRu,
      verifiedSince: iso(o.approvedAt),
      packageCount: o._count.packages,
      ...(ratings.get(o.id) ?? { reviewCount: 0, averageRating: null }),
    }));
  }

  async operator(slug: string): Promise<PublicOperatorDetail> {
    const today = new Date(new Date().toISOString().slice(0, 10));
    const o = await this.prisma.operator.findFirst({
      where: { ...LISTED, slug },
      include: {
        country: true,
        packages: {
          where: { status: 'PUBLISHED' },
          orderBy: { title: 'asc' },
          include: { dateRanges: { where: { endDate: { gte: today } }, orderBy: { startDate: 'asc' } } },
        },
        reviews: {
          where: { status: 'PUBLISHED' },
          orderBy: { tripDate: 'desc' },
          take: 50,
          include: { package: { select: { title: true, titleRu: true } } },
        },
      },
    });
    if (!o) throw new NotFoundException('Operator not found');
    const rating = (await this.ratings([o.id])).get(o.id) ?? { reviewCount: 0, averageRating: null };
    return {
      slug: o.slug,
      name: o.name,
      countryCode: o.countryCode,
      licensingAuthority: o.licensingAuthority,
      yearEstablished: o.yearEstablished,
      descriptionRu: o.descriptionRu,
      descriptionEn: o.descriptionEn,
      verifiedSince: iso(o.approvedAt),
      tourismBoardLicense: o.tourismBoardLicense,
      businessRegNumber: o.businessRegNumber,
      websiteUrl: o.websiteUrl,
      verificationVideoUrl: o.verificationVideoUrl,
      telegramUsername: o.telegramUsername,
      responseTimeScore: o.responseTimeScore,
      completenessScore: o.completenessScore,
      country: o.country,
      packageCount: o.packages.length,
      ...rating,
      packages: o.packages.map((p) => ({
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
        dates: p.dateRanges.map((d) => ({ startDate: isoDate(d.startDate), endDate: isoDate(d.endDate), capacity: d.capacity })),
      })),
      reviews: o.reviews.map((r) => ({
        id: r.id,
        authorName: r.authorName,
        rating: r.rating,
        bodyRu: r.bodyRu,
        bodyEn: r.bodyEn,
        tripDate: isoDate(r.tripDate),
        packageTitle: r.package ? (r.package.titleRu ?? r.package.title) : null,
        operatorReply: r.operatorReply,
      })),
    };
  }

  async badge(token: string): Promise<BadgeStatus> {
    const o = await this.prisma.operator.findUnique({ where: { badgeToken: token } });
    if (!o || (o.status !== 'APPROVED' && o.status !== 'SUSPENDED')) return { state: 'not_verified' };
    return {
      state: o.status === 'APPROVED' ? 'verified' : 'revoked',
      operator: {
        name: o.name,
        slug: o.slug,
        countryCode: o.countryCode,
        licensingAuthority: o.licensingAuthority,
        verifiedSince: o.status === 'APPROVED' ? iso(o.approvedAt) : null,
      },
    };
  }

  async visaGuides(countryCode?: string): Promise<PublicVisaGuide[]> {
    const guides = await this.prisma.visaGuide.findMany({
      where: {
        status: 'PUBLISHED',
        ...(countryCode && { OR: [{ countryCode }, { coveredCountries: { has: countryCode } }] }),
      },
      orderBy: [{ countryCode: 'asc' }, { titleRu: 'asc' }],
    });
    return guides.map(toPublicVisaGuide);
  }

  async visaGuide(slug: string): Promise<PublicVisaGuide> {
    const g = await this.prisma.visaGuide.findFirst({ where: { slug, status: 'PUBLISHED' } });
    if (!g) throw new NotFoundException('Visa guide not found');
    return toPublicVisaGuide(g);
  }

  async guides(params: { countryCode?: string; kind?: 'DESTINATION' | 'LOGISTICS' }): Promise<PublicDestinationGuide[]> {
    const guides = await this.prisma.destinationGuide.findMany({
      where: { status: 'PUBLISHED', countryCode: params.countryCode, kind: params.kind },
      orderBy: [{ countryCode: 'asc' }, { kind: 'asc' }, { titleRu: 'asc' }],
    });
    return guides.map(toPublicGuide);
  }

  async guide(slug: string): Promise<PublicDestinationGuide> {
    const g = await this.prisma.destinationGuide.findFirst({ where: { slug, status: 'PUBLISHED' } });
    if (!g) throw new NotFoundException('Guide not found');
    return toPublicGuide(g);
  }

  private async ratings(operatorIds: string[]) {
    if (!operatorIds.length) return new Map<string, { reviewCount: number; averageRating: number | null }>();
    const rows = await this.prisma.review.groupBy({
      by: ['operatorId'],
      where: { operatorId: { in: operatorIds }, status: 'PUBLISHED' },
      _count: { _all: true },
      _avg: { rating: true },
    });
    return new Map(
      rows.map((r) => [
        r.operatorId,
        { reviewCount: r._count._all, averageRating: r._avg.rating === null ? null : Math.round(r._avg.rating * 10) / 10 },
      ]),
    );
  }
}

function toPublicVisaGuide(g: Prisma.VisaGuideGetPayload<object>): PublicVisaGuide {
  return {
    slug: g.slug,
    countryCode: g.countryCode,
    coveredCountries: g.coveredCountries,
    visaType: g.visaType,
    titleRu: g.titleRu,
    requirementsRu: g.requirementsRu,
    checklistItems: (g.checklistItems as unknown as ChecklistItem[]) ?? [],
    officialUrl: g.officialUrl,
    feeInfo: g.feeInfo,
    processingTime: g.processingTime,
    lastUpdated: g.lastUpdated.toISOString(),
  };
}

function toPublicGuide(g: Prisma.DestinationGuideGetPayload<object>): PublicDestinationGuide {
  return {
    slug: g.slug,
    countryCode: g.countryCode,
    kind: g.kind,
    titleRu: g.titleRu,
    summaryRu: g.summaryRu,
    bodyRu: g.bodyRu,
    lastUpdated: g.lastUpdated.toISOString(),
    publishedAt: iso(g.publishedAt),
  };
}
