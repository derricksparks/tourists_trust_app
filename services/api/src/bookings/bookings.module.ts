import { BadRequestException, Body, Controller, ForbiddenException, Get, Injectable, Module, NotFoundException, Param, ParseUUIDPipe, Put, Query, Res, UseGuards } from '@nestjs/common';
import { Account, BookingSide, Prisma } from '@prisma/client';
import { BookingReportInput, bookingReportSchema, bookingState } from '@ttp/shared-types';
import { Response } from 'express';
import { z } from 'zod';
import { AdminAuthGuard } from '../admin-auth/admin-auth.guard';
import { PrismaService } from '../common/prisma.service';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { NotificationsService } from '../mail/notifications.service';
import { CurrentAccount, PortalAccount, PortalAuthGuard, PortalRoles } from '../portal/portal-auth';
import { ScoringService } from '../scoring/scoring.service';

const day = (d: string) => new Date(`${d}T00:00:00Z`);
const iso = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);

/** Adds the computed agreement state to anything carrying its booking reports. */
export function withBooking<T extends { bookingReports: Prisma.QuoteBookingReportGetPayload<object>[] }>(q: T) {
  return { ...q, booking: bookingState(q.bookingReports) };
}

const reportQuery = z.object({
  from: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/),
  to: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/),
});
type ReportQuery = z.infer<typeof reportQuery>;

/**
 * Whether quotes became bookings (pilot round). Each side reports for itself; staff see where
 * they disagree, and a monthly report of confirmed bookings lets us invoice introduction fees by
 * hand. Nothing here takes, records or schedules a payment.
 */
@Injectable()
export class BookingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    private readonly scoring: ScoringService,
  ) {}

  async report(quoteId: string, side: BookingSide, input: BookingReportInput, account: Account, scope: Prisma.QuoteRequestWhereInput) {
    const quote = await this.prisma.quoteRequest.findFirst({ where: { id: quoteId, ...scope }, include: { package: true } });
    if (!quote) throw new NotFoundException('Quote request not found');
    const data = {
      outcome: input.outcome,
      bookedOn: input.bookedOn ? day(input.bookedOn) : null,
      netPrice: input.netPrice ?? null,
      currency: input.currency ?? null,
      pax: input.pax ?? null,
      note: input.note ?? null,
      reportedByAccountId: account.id,
    };
    await this.prisma.$transaction(async (tx) => {
      await tx.quoteBookingReport.upsert({
        where: { quoteRequestId_side: { quoteRequestId: quoteId, side } },
        create: { quoteRequestId: quoteId, side, ...data },
        update: data,
      });
      // A reported outcome ends the negotiation.
      if (quote.status !== 'CLOSED') await tx.quoteRequest.update({ where: { id: quoteId }, data: { status: 'CLOSED', closedAt: new Date() } });
      await tx.auditLog.create({
        data: { actorAccountId: account.id, action: 'quote.booking_report', entityType: 'quote_request', entityId: quoteId, reason: input.note, metadata: { side, ...input } },
      });
    });
    if (quote.status !== 'CLOSED') await this.scoring.recompute(quote.package.operatorId);
    const updated = await this.prisma.quoteRequest.findUniqueOrThrow({ where: { id: quoteId }, include: { bookingReports: true } });
    this.notifications.bookingReported(quoteId, side, bookingState(updated.bookingReports).state);
    return withBooking(updated);
  }

  /** Every quote with at least one report whose booking date (DMC's, else operator's) is in the months asked. */
  async monthly(q: ReportQuery) {
    const from = day(`${q.from}-01`);
    const toStart = day(`${q.to}-01`);
    const to = new Date(Date.UTC(toStart.getUTCFullYear(), toStart.getUTCMonth() + 1, 1));
    if (to <= from) throw new BadRequestException('"to" is before "from"');
    const quotes = await this.prisma.quoteRequest.findMany({
      where: { bookingReports: { some: { outcome: 'BOOKED', bookedOn: { gte: from, lt: to } } } },
      include: { bookingReports: true, dmc: { select: { id: true, name: true } }, package: { select: { title: true, operator: { select: { id: true, name: true } } } } },
      orderBy: { createdAt: 'asc' },
    });
    const rows = quotes.map((qr) => {
      const dmc = qr.bookingReports.find((r) => r.side === 'DMC');
      const op = qr.bookingReports.find((r) => r.side === 'OPERATOR');
      const main = dmc?.outcome === 'BOOKED' ? dmc : op?.outcome === 'BOOKED' ? op : (dmc ?? op)!;
      const bookedOn = (dmc?.outcome === 'BOOKED' ? dmc.bookedOn : null) ?? (op?.outcome === 'BOOKED' ? op.bookedOn : null);
      const { state, differences } = bookingState(qr.bookingReports);
      return {
        quoteId: qr.id,
        month: iso(bookedOn)!.slice(0, 7),
        bookedOn: iso(bookedOn),
        operator: qr.package.operator,
        dmc: qr.dmc,
        tour: qr.package.title,
        pax: main.pax ?? qr.pax,
        netPrice: main.netPrice?.toString() ?? null,
        currency: main.currency,
        state,
        differences,
        dmcReport: dmc ? { outcome: dmc.outcome, bookedOn: iso(dmc.bookedOn), pax: dmc.pax, netPrice: dmc.netPrice?.toString() ?? null, currency: dmc.currency, updatedAt: dmc.updatedAt } : null,
        operatorReport: op ? { outcome: op.outcome, bookedOn: iso(op.bookedOn), pax: op.pax, netPrice: op.netPrice?.toString() ?? null, currency: op.currency, updatedAt: op.updatedAt } : null,
      };
    });
    const confirmed = rows.filter((r) => r.state === 'confirmed');
    const group = (key: 'operator' | 'dmc') => {
      const m = new Map<string, { month: string; id: string; name: string; bookings: number; pax: number }>();
      for (const r of confirmed) {
        const k = `${r.month}|${r[key].id}`;
        const g = m.get(k) ?? { month: r.month, id: r[key].id, name: r[key].name, bookings: 0, pax: 0 };
        g.bookings += 1;
        g.pax += r.pax ?? 0;
        m.set(k, g);
      }
      return [...m.values()].sort((a, b) => a.month.localeCompare(b.month) || a.name.localeCompare(b.name));
    };
    return {
      from: q.from,
      to: q.to,
      confirmed,
      needsAttention: rows.filter((r) => r.state !== 'confirmed'),
      byOperator: group('operator'),
      byDmc: group('dmc'),
    };
  }
}

const csvCell = (v: unknown) => {
  const s = v === null || v === undefined ? '' : String(v);
  // Quote anything with separators, quotes or line breaks; neutralise spreadsheet formulas.
  const safe = /^[=+\-@]/.test(s) ? `'${s}` : s;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};
export const toCsv = (header: string[], rows: unknown[][]) => [header, ...rows].map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n';

@Controller('portal/dmc/quotes')
@UseGuards(PortalAuthGuard)
@PortalRoles('DMC')
export class DmcBookingController {
  constructor(private readonly svc: BookingsService) {}

  @Put(':id/booking')
  booking(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodValidationPipe(bookingReportSchema)) body: BookingReportInput, @CurrentAccount() a: PortalAccount) {
    if (a.dmc?.status !== 'APPROVED') throw new ForbiddenException('Ваша компания ещё на проверке.');
    return this.svc.report(id, 'DMC', body, a, { dmcId: a.dmc.id });
  }
}

@Controller('portal/operator/quotes')
@UseGuards(PortalAuthGuard)
@PortalRoles('OPERATOR')
export class OperatorBookingController {
  constructor(private readonly svc: BookingsService) {}

  @Put(':id/booking')
  booking(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodValidationPipe(bookingReportSchema)) body: BookingReportInput, @CurrentAccount() a: PortalAccount) {
    if (a.operator?.status !== 'APPROVED') throw new ForbiddenException('Your listing is not active, so changes are paused. Contact us.');
    return this.svc.report(id, 'OPERATOR', body, a, { package: { operatorId: a.operator.id } });
  }
}

/** Monthly report of bookings for invoicing introduction fees by hand (no billing in the platform). */
@Controller('admin/bookings')
@UseGuards(AdminAuthGuard)
export class AdminBookingsController {
  constructor(private readonly svc: BookingsService) {}

  @Get()
  report(@Query(new ZodValidationPipe(reportQuery)) q: ReportQuery) {
    return this.svc.monthly(q);
  }

  /** view=bookings: one row per confirmed booking; view=operators / dmcs: totals per month. */
  @Get('export.csv')
  async csv(@Query(new ZodValidationPipe(reportQuery.extend({ view: z.enum(['bookings', 'operators', 'dmcs']).default('bookings') }))) q: ReportQuery & { view: 'bookings' | 'operators' | 'dmcs' }, @Res() res: Response) {
    const r = await this.svc.monthly(q);
    const body =
      q.view === 'bookings'
        ? toCsv(
            ['month', 'booked_on', 'operator', 'dmc', 'tour', 'travellers', 'agreed_net_price', 'currency', 'quote_id'],
            r.confirmed.map((b) => [b.month, b.bookedOn, b.operator.name, b.dmc.name, b.tour, b.pax, b.netPrice, b.currency, b.quoteId]),
          )
        : toCsv(
            ['month', q.view === 'operators' ? 'operator' : 'dmc', 'confirmed_bookings', 'travellers'],
            (q.view === 'operators' ? r.byOperator : r.byDmc).map((g) => [g.month, g.name, g.bookings, g.pax]),
          );
    res.set({ 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="bookings-${q.view}-${q.from}-to-${q.to}.csv"` });
    // Byte-order mark so Excel opens Cyrillic names correctly.
    res.send(`﻿${body}`);
  }
}

@Module({ controllers: [DmcBookingController, OperatorBookingController, AdminBookingsController], providers: [BookingsService], exports: [BookingsService] })
export class BookingsModule {}
