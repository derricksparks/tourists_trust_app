import type { PublicCountry, PublicOperatorDetail, PublicOperatorSummary } from '@ttp/shared-types';

/** Read-only client for the core API's public endpoints; the bot never touches the database. */
export interface CoreApi {
  countries(): Promise<PublicCountry[]>;
  operators(country?: string): Promise<PublicOperatorSummary[]>;
  operator(slug: string): Promise<PublicOperatorDetail | null>;
}

export class HttpCoreApi implements CoreApi {
  constructor(private readonly baseUrl: string) {}

  private async get<T>(path: string): Promise<T | null> {
    const res = await fetch(`${this.baseUrl.replace(/\/$/, '')}/public${path}`, { signal: AbortSignal.timeout(10_000) });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`API ${path} returned ${res.status}`);
    return (await res.json()) as T;
  }

  async countries() {
    return (await this.get<PublicCountry[]>('/countries')) ?? [];
  }

  async operators(country?: string) {
    return (await this.get<PublicOperatorSummary[]>(`/operators${country ? `?country=${encodeURIComponent(country)}` : ''}`)) ?? [];
  }

  operator(slug: string) {
    return this.get<PublicOperatorDetail>(`/operators/${encodeURIComponent(slug)}`);
  }
}
