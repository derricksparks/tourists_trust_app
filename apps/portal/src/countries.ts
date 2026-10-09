import { useQuery } from '@tanstack/react-query';
import { api } from './api';
import { registerCountries } from './format';

/** Destinations operators can be listed in (managed by staff); also teaches the name helpers. */
export function useCountries() {
  return useQuery({
    queryKey: ['countries'],
    queryFn: async () => {
      const list = await api.countries();
      registerCountries(list);
      return list;
    },
    staleTime: 10 * 60 * 1000,
  });
}
