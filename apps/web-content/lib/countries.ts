import type { PublicCountry } from '@ttp/shared-types';
import { publicApi } from './api';
import { registerCountries } from './format';

/**
 * Loads the destination list (cached with the operator pages) and teaches the name helpers about
 * countries staff added. Pages still render with the built-in names if the API is unreachable.
 */
export async function loadCountries(): Promise<PublicCountry[]> {
  try {
    const list = await publicApi.countries();
    registerCountries(list);
    return list;
  } catch {
    return [];
  }
}

/** "Уганда · Танзания · Кения": destinations that have verified operators listed. */
export function destinationsLine(list: PublicCountry[]): string {
  const withOperators = list.filter((c) => c.operatorCount > 0).map((c) => c.nameRu);
  return withOperators.length ? withOperators.join(' · ') : 'Уганда · Танзания · Кения';
}
