import { Prisma } from '@prisma/client';
import { PackageInput } from '@ttp/shared-types';
import { slugify } from '../operators/operators.service';

export const packageInclude = {
  dateRanges: { orderBy: { startDate: 'asc' } },
  _count: { select: { quoteRequests: true, listings: true } },
} satisfies Prisma.PackageInclude;

const day = (d: string) => new Date(`${d}T00:00:00Z`);

/** Turns the form input into Prisma data; dates replace the package's existing ranges. */
export function packageData(input: PackageInput) {
  const { dates, price, currency, ...rest } = input;
  return {
    ...rest,
    price: price ?? null,
    currency: price == null ? null : currency ?? null,
    dateRanges: { create: dates.map((d) => ({ startDate: day(d.startDate), endDate: day(d.endDate), capacity: d.capacity ?? null })) },
  };
}

export async function uniquePackageSlug(tx: Prisma.TransactionClient, title: string, operatorSlug: string): Promise<string> {
  const base = slugify(`${title}-${operatorSlug.split('-').slice(0, 2).join('-')}`) || 'tour';
  const taken = new Set((await tx.package.findMany({ where: { slug: { startsWith: base } }, select: { slug: true } })).map((p) => p.slug));
  if (!taken.has(base)) return base;
  for (let n = 2; ; n++) if (!taken.has(`${base}-${n}`)) return `${base}-${n}`;
}
