import { Global, Injectable, Logger, Module } from '@nestjs/common';
import { OperatorScoreBreakdown } from '@ttp/shared-types';
import { PrismaService } from '../common/prisma.service';

const WINDOW_DAYS = 90;
/** Answering within FAST_HOURS scores 100; at SLOW_HOURS or later (or never) it scores 0. */
const FAST_HOURS = 2;
const SLOW_HOURS = 72;

/** Points for each part of a complete listing; they add up to 100. */
const COMPLETENESS: { key: string; label: string; points: number }[] = [
  { key: 'descriptionRu', label: 'Description in Russian', points: 20 },
  { key: 'descriptionEn', label: 'Description in English', points: 10 },
  { key: 'video', label: 'Verification video (office, camp or vehicles)', points: 20 },
  { key: 'website', label: 'Website', points: 10 },
  { key: 'yearEstablished', label: 'Year established', points: 5 },
  { key: 'contact', label: 'Telegram username or phone', points: 10 },
  { key: 'package', label: 'At least one published tour', points: 15 },
  { key: 'dates', label: 'Upcoming dates on a published tour', points: 10 },
];

export function median(values: number[]): number | null {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

export function responseScore(medianHours: number | null): number | null {
  if (medianHours === null) return null;
  const score = 100 * (1 - (medianHours - FAST_HOURS) / (SLOW_HOURS - FAST_HOURS));
  return Math.round(Math.min(100, Math.max(0, score)));
}

/**
 * Operator scores (spec TV-6), computed from activity, never entered by hand.
 * Response time: median hours to the first answer, over traveller inquiries and DMC quote
 * requests from the last 90 days. Requests still unanswered after 72 hours count as 72 hours.
 * Completeness: points for the parts of a listing travellers rely on (see COMPLETENESS).
 */
@Injectable()
export class ScoringService {
  private readonly logger = new Logger(ScoringService.name);

  constructor(private readonly prisma: PrismaService) {}

  async breakdown(operatorId: string, now = new Date()): Promise<OperatorScoreBreakdown> {
    const since = new Date(now.getTime() - WINDOW_DAYS * 24 * 3600 * 1000);
    const today = new Date(now.toISOString().slice(0, 10));
    const [operator, inquiries, quotes] = await Promise.all([
      this.prisma.operator.findUniqueOrThrow({
        where: { id: operatorId },
        include: { packages: { where: { status: 'PUBLISHED' }, include: { dateRanges: { where: { endDate: { gte: today } }, take: 1 } } } },
      }),
      this.prisma.inquiry.findMany({ where: { operatorId, createdAt: { gte: since } }, select: { createdAt: true, firstResponseAt: true } }),
      this.prisma.quoteRequest.findMany({ where: { package: { operatorId }, createdAt: { gte: since } }, select: { createdAt: true, quotedAt: true, closedAt: true } }),
    ]);

    const hours: number[] = [];
    const add = (asked: Date, answered: Date | null) => {
      const h = ((answered ?? now).getTime() - asked.getTime()) / 3_600_000;
      // Too new to judge yet: skip until it's answered or 72 hours have passed.
      if (!answered && h < SLOW_HOURS) return;
      hours.push(Math.min(Math.max(h, 0), SLOW_HOURS));
    };
    inquiries.forEach((i) => add(i.createdAt, i.firstResponseAt));
    quotes.forEach((q) => add(q.createdAt, q.quotedAt ?? q.closedAt));
    const med = median(hours);

    const has: Record<string, boolean> = {
      descriptionRu: !!operator.descriptionRu,
      descriptionEn: !!operator.descriptionEn,
      video: !!operator.verificationVideoUrl,
      website: !!operator.websiteUrl,
      yearEstablished: !!operator.yearEstablished,
      contact: !!operator.telegramUsername || !!operator.phone,
      package: operator.packages.length > 0,
      dates: operator.packages.some((p) => p.dateRanges.length > 0),
    };
    const missing = COMPLETENESS.filter((c) => !has[c.key]);
    return {
      responseTimeScore: responseScore(med),
      medianResponseHours: med === null ? null : Math.round(med * 10) / 10,
      responsesCounted: hours.length,
      completenessScore: 100 - missing.reduce((a, c) => a + c.points, 0),
      missing,
    };
  }

  /** Recompute and store both scores. Best effort: a failure is logged, never surfaced to the caller. */
  async recompute(operatorId: string): Promise<void> {
    try {
      const b = await this.breakdown(operatorId);
      await this.prisma.operator.update({
        where: { id: operatorId },
        data: { responseTimeScore: b.responseTimeScore, completenessScore: b.completenessScore, scoresComputedAt: new Date() },
      });
    } catch (e) {
      this.logger.warn(`Score recompute for ${operatorId} failed: ${(e as Error).message}`);
    }
  }

  async recomputeAll(): Promise<number> {
    const ops = await this.prisma.operator.findMany({ select: { id: true } });
    for (const o of ops) await this.recompute(o.id);
    return ops.length;
  }
}

@Global()
@Module({ providers: [ScoringService], exports: [ScoringService] })
export class ScoringModule {}
