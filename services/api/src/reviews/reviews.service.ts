import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { AdminUser, Prisma } from '@prisma/client';
import { REVIEW_TRANSITIONS, ReviewDecisionInput, ReviewListQuery } from '@ttp/shared-types';
import { PrismaService } from '../common/prisma.service';
import { RevalidationService } from '../common/revalidation.service';

const reviewInclude = {
  operator: { select: { id: true, name: true, slug: true, countryCode: true } },
  package: { select: { id: true, title: true } },
  invite: { select: { recipientName: true, recipientContact: true, tripDate: true, createdAt: true } },
  moderatedBy: { select: { id: true, name: true } },
} satisfies Prisma.ReviewInclude;

@Injectable()
export class ReviewsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly revalidation: RevalidationService,
  ) {}

  async list(query: ReviewListQuery) {
    const where: Prisma.ReviewWhereInput = { status: query.status };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.review.findMany({
        where,
        include: reviewInclude,
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.prisma.review.count({ where }),
    ]);
    return { items, total, page: query.page, pageSize: query.pageSize };
  }

  async decide(id: string, { decision, reason }: ReviewDecisionInput, admin: AdminUser) {
    const { from, to } = REVIEW_TRANSITIONS[decision];
    const review = await this.prisma.$transaction(async (tx) => {
      const { count } = await tx.review.updateMany({
        where: { id, status: { in: [...from] } },
        data: {
          status: to,
          rejectionReason: decision === 'reject' ? reason : null,
          moderatedById: admin.id,
          moderatedAt: new Date(),
        },
      });
      if (count === 0) {
        const current = await tx.review.findUnique({ where: { id }, select: { status: true } });
        if (!current) throw new NotFoundException('Review not found');
        throw new ConflictException(`Cannot ${decision} a review whose status is ${current.status}`);
      }
      await tx.auditLog.create({
        data: { actorAdminId: admin.id, action: `review.${decision}`, entityType: 'review', entityId: id, reason, metadata: { to } },
      });
      return tx.review.findUniqueOrThrow({ where: { id }, include: reviewInclude });
    });
    this.revalidation.revalidate('operators');
    return review;
  }
}
