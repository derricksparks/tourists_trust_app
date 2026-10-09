/**
 * Russian country names. Countries are managed by staff (Phase 4), so the list is filled from the
 * API by registerCountries (site and Mini App layouts); these launch countries are the fallback.
 */
const COUNTRY_RU = new Map<string, { name: string; in: string }>([
  ['UG', { name: 'Уганда', in: 'в Уганде' }],
  ['TZ', { name: 'Танзания', in: 'в Танзании' }],
  ['KE', { name: 'Кения', in: 'в Кении' }],
  ['RW', { name: 'Руанда', in: 'в Руанде' }],
  ['RU', { name: 'Россия', in: 'в России' }],
]);
export function registerCountries(list: { code: string; nameRu: string; nameRuIn: string | null }[]) {
  for (const c of list) COUNTRY_RU.set(c.code, { name: c.nameRu, in: c.nameRuIn ?? `в стране ${c.nameRu}` });
}
export const countryRu = (code: string) => COUNTRY_RU.get(code)?.name ?? code;
export const countryRuIn = (code: string) => COUNTRY_RU.get(code)?.in ?? code;

/** Russian plural: plural(5, ['отзыв', 'отзыва', 'отзывов']) → 'отзывов'. */
export function plural(n: number, [one, few, many]: [string, string, string]) {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
}
export const count = (n: number, forms: [string, string, string]) => `${n} ${plural(n, forms)}`;

export const dateRu = (iso: string) =>
  new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(iso));
export const monthYearRu = (iso: string) =>
  new Intl.DateTimeFormat('ru-RU', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(iso));
export const dateRangeRu = (start: string, end: string) => {
  const f = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'short', timeZone: 'UTC' });
  return `${f.format(new Date(start))} – ${f.format(new Date(end))} ${new Date(end).getUTCFullYear()}`;
};

/** Indicative price for display; the platform never takes payment. */
export function priceRu(price: string | null, currency: string | null, basis: 'PER_PERSON' | 'PER_GROUP') {
  if (!price || !currency) return null;
  const amount = new Intl.NumberFormat('ru-RU', { style: 'currency', currency, maximumFractionDigits: 0 }).format(Number(price));
  return `от ${amount} ${basis === 'PER_PERSON' ? 'с человека' : 'за группу'}`;
}

export const yearsRu = (since: number) => {
  const n = new Date().getUTCFullYear() - since;
  return count(n, ['год', 'года', 'лет']);
};

const MONTHS_GENITIVE = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
/** "с сентября 2026" */
export const sinceRu = (iso: string) => {
  const d = new Date(iso);
  return `с ${MONTHS_GENITIVE[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
};
