import type { MetadataRoute } from 'next';
import { publicApi, SITE_URL } from '@/lib/api';

export const revalidate = 3600;

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const [operators, visas, guides, countries] = await Promise.all([
    publicApi.operators(),
    publicApi.visaGuides(),
    publicApi.guides(),
    publicApi.countries(),
  ]);
  const page = (path: string, lastModified?: string) => ({ url: `${SITE_URL}${path}`, ...(lastModified && { lastModified }) });
  return [
    page('/'),
    page('/operators'),
    ...countries.filter((c) => c.operatorCount > 0).map((c) => page(`/operators?country=${c.code}`)),
    ...operators.map((o) => page(`/operators/${o.slug}`)),
    ...(await Promise.all(operators.map((o) => publicApi.operator(o.slug)))).flatMap((o) => o.packages.map((p) => page(`/tours/${p.slug}`))),
    page('/visa'),
    ...visas.map((v) => page(`/visa/${v.slug}`, v.lastUpdated)),
    page('/translators'),
    page('/insurance'),
    page('/guides'),
    ...guides.map((g) => page(`/guides/${g.slug}`, g.lastUpdated)),
  ];
}
