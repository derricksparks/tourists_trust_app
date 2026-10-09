import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

/** Reference countries for a fresh database (seed and cli/setup). Staff add more in the dashboard. */
export const REFERENCE_COUNTRIES = [
  { code: 'UG', nameEn: 'Uganda', nameRu: 'Уганда', nameRuIn: 'в Уганде', active: true, licensingAuthority: 'Uganda Tourism Board' },
  { code: 'TZ', nameEn: 'Tanzania', nameRu: 'Танзания', nameRuIn: 'в Танзании', active: true, licensingAuthority: 'Tanzania Tourist Agency Licensing Authority (TALA)' },
  { code: 'KE', nameEn: 'Kenya', nameRu: 'Кения', nameRuIn: 'в Кении', active: true, licensingAuthority: 'Tourism Regulatory Authority (Kenya)' },
  { code: 'RW', nameEn: 'Rwanda', nameRu: 'Руанда', nameRuIn: 'в Руанде', active: true, licensingAuthority: 'Rwanda Development Board' },
  // The DMCs' country: reference only, operators are not listed here.
  { code: 'RU', nameEn: 'Russia', nameRu: 'Россия', nameRuIn: 'в России', active: false, licensingAuthority: null },
];

/** Operators, tours and translators may only use countries staff have switched on. */
export async function activeCountry(db: Pick<Prisma.TransactionClient, 'country'>, code: string) {
  const c = await db.country.findUnique({ where: { code } });
  if (!c?.active) throw new BadRequestException(`We don't list operators in ${code} yet`);
  return c;
}
