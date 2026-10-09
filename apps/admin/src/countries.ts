import { useQuery } from '@tanstack/react-query';
import { api } from './api';
import { registerCountries } from './format';

/** All countries (staff manage them on the Countries page); also teaches countryName() new ones. */
export function useCountries() {
  return useQuery({
    queryKey: ['countries'],
    queryFn: async () => {
      const list = await api.countries();
      registerCountries(list);
      return list;
    },
    staleTime: 5 * 60 * 1000,
  });
}

/** Codes of the destinations that are switched on, for country pickers. */
export function useActiveCountryCodes(): string[] {
  return (useCountries().data ?? []).filter((c) => c.active).map((c) => c.code);
}
