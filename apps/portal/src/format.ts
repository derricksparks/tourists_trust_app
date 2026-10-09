/** Country names; staff add countries (Phase 4), so useCountries() adds them from the API. */
export const COUNTRY_EN: Record<string, string> = { UG: 'Uganda', TZ: 'Tanzania', KE: 'Kenya', RW: 'Rwanda', RU: 'Russia' };
export const COUNTRY_RU: Record<string, string> = { UG: 'Уганда', TZ: 'Танзания', KE: 'Кения', RW: 'Руанда', RU: 'Россия' };
export function registerCountries(list: { code: string; nameEn: string; nameRu: string }[]) {
  for (const c of list) {
    COUNTRY_EN[c.code] = c.nameEn;
    COUNTRY_RU[c.code] = c.nameRu;
  }
}
export const dateEn = (iso: string) => new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
export const dateRu = (iso: string) => new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(new Date(iso));
export const money = (amount: string | number, currency: string, locale = 'en-GB') =>
  new Intl.NumberFormat(locale, { style: 'currency', currency, maximumFractionDigits: 0 }).format(Number(amount));
export const PUBLIC_SITE = (import.meta.env.VITE_PUBLIC_SITE_URL ?? 'http://localhost:3001').replace(/\/$/, '');
