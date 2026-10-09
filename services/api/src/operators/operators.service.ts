import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { AdminUser, Operator, Prisma } from '@prisma/client';
import {
  OperatorCreateInput,
  OperatorDecisionInput,
  OPERATOR_TRANSITIONS,
  OperatorListQuery,
  OperatorUpdateInput,
  Paginated,
} from '@ttp/shared-types';
import { randomBytes } from 'crypto';
import { PrismaService } from '../common/prisma.service';
import { RevalidationService } from '../common/revalidation.service';
import { ScoringService } from '../scoring/scoring.service';

export function slugify(text: string): string {
  return text
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

/** 32 random bytes, URL-safe; identifies an operator in the embeddable badge. */
export function newBadgeToken(): string {
  return randomBytes(32).toString('base64url');
}

@Injectable()
export class OperatorsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly revalidation: RevalidationService,
    private readonly scoring: ScoringService,
  ) {}

  async list(query: OperatorListQuery): Promise<Paginated<Operator>> {
    const where: Prisma.OperatorWhereInput = {
      status: query.status,
      countryCode: query.countryCode,
      ...(query.q && {
        OR: [
          { name: { contains: query.q, mode: 'insensitive' } },
          { businessRegNumber: { contains: query.q, mode: 'insensitive' } },
          { tourismBoardLicense: { contains: query.q, mode: 'insensitive' } },
        ],
      }),
    };
    const [items, total] = await this.prisma.$transaction([
      // Oldest first, so the approval queue is worked in arrival order.
      this.prisma.operator.findMany({
        where,
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.prisma.operator.count({ where }),
    ]);
    return { items, total, page: query.page, pageSize: query.pageSize };
  }

  async get(id: string) {
    const operator = await this.prisma.operator.findUnique({
      where: { id },
      include: { country: true, documents: true, media: true },
    });
    if (!operator) throw new NotFoundException('Operator not found');
    const history = await this.prisma.auditLog.findMany({
      where: { entityType: 'operator', entityId: id },
      orderBy: { createdAt: 'desc' },
      include: { actorAdmin: { select: { id: true, name: true } } },
    });
    return { ...operator, history };
  }

  async create(input: OperatorCreateInput, admin: AdminUser): Promise<Operator> {
    const slug = await this.uniqueSlug(`${input.name}-${input.countryCode}`);
    return this.prisma.$transaction(async (tx) => {
      const operator = await tx.operator
        .create({ data: { ...input, slug, badgeToken: newBadgeToken() } })
        .catch(mapPrismaError);
      await tx.auditLog.create({
        data: { actorAdminId: admin.id, action: 'operator.create', entityType: 'operator', entityId: operator.id },
      });
      return operator;
    });
  }

  async update(id: string, input: OperatorUpdateInput, admin: AdminUser): Promise<Operator> {
    const operator = await this.prisma.$transaction(async (tx) => {
      const operator = await tx.operator.update({ where: { id }, data: input }).catch(mapPrismaError);
      await tx.auditLog.create({
        data: {
          actorAdminId: admin.id,
          action: 'operator.update',
          entityType: 'operator',
          entityId: id,
          metadata: { fields: Object.keys(input) },
        },
      });
      return operator;
    });
    await this.scoring.recompute(id);
    if (operator.status === 'APPROVED') this.revalidation.revalidate('operators');
    return operator;
  }

  async decide(id: string, { decision, reason }: OperatorDecisionInput, admin: AdminUser): Promise<Operator> {
    const { from, to } = OPERATOR_TRANSITIONS[decision];
    const operator = await this.prisma.$transaction(async (tx) => {
      // Conditional update: two moderators deciding at once can't both succeed.
      const { count } = await tx.operator.updateMany({
        where: { id, status: { in: [...from] } },
        data: {
          status: to,
          statusReason: decision === 'approve' ? null : reason,
          ...(decision === 'approve' && { approvedAt: new Date(), approvedById: admin.id }),
        },
      });
      if (count === 0) {
        const current = await tx.operator.findUnique({ where: { id }, select: { status: true } });
        if (!current) throw new NotFoundException('Operator not found');
        throw new ConflictException(`Cannot ${decision} an operator whose status is ${current.status}`);
      }
      await tx.auditLog.create({
        data: {
          actorAdminId: admin.id,
          action: `operator.${decision}`,
          entityType: 'operator',
          entityId: id,
          reason,
          metadata: { to },
        },
      });
      return tx.operator.findUniqueOrThrow({ where: { id } });
    });
    // Approving or suspending changes the public site and every embedded badge.
    this.revalidation.revalidate('operators');
    return operator;
  }

  private async uniqueSlug(text: string): Promise<string> {
    const base = slugify(text) || 'operator';
    const taken = await this.prisma.operator.findMany({
      where: { slug: { startsWith: base } },
      select: { slug: true },
    });
    const used = new Set(taken.map((o) => o.slug));
    if (!used.has(base)) return base;
    for (let n = 2; ; n++) if (!used.has(`${base}-${n}`)) return `${base}-${n}`;
  }
}

function mapPrismaError(e: unknown): never {
  if (e instanceof Prisma.PrismaClientKnownRequestError) {
    if (e.code === 'P2025') throw new NotFoundException('Operator not found');
    if (e.code === 'P2003') throw new BadRequestException('Unknown country code');
    if (e.code === 'P2002') throw new ConflictException('An operator with these details already exists');
  }
  throw e;
}
