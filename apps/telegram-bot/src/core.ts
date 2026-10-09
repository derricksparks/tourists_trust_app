import type { PublicCountry, PublicOperatorDetail, PublicOperatorSummary } from '@ttp/shared-types';

/** Read-only client for the core API's public endpoints; the bot never touches the database. */
export interface CoreApi {
  countries(): Promise<PublicCountry[]>;
  operators(country?: string): Promise<PublicOperatorSummary[]>;
  operator(slug: string): Promise<PublicOperatorDetail | null>;
  /** Translator pressed Accept / Decline / Done on a job offer. Returns the text to show them. */
  jobAction(jobId: string, telegramId: number, action: 'accept' | 'decline' | 'complete'): Promise<ApiReply>;
  /** Traveller rated a finished job. */
  rateJob(jobId: string, telegramId: number, rating: number): Promise<ApiReply>;
}

/** ok=false carries the API's message (already in Russian) for an alert. */
export interface ApiReply {
  ok: boolean;
  message: string;
}

export class HttpCoreApi implements CoreApi {
  /** botSecret: see botInternalSecret in the API (HMAC of the bot token), sent as X-Bot-Secret. */
  constructor(
    private readonly baseUrl: string,
    private readonly botSecret = '',
  ) {}

  private async post(path: string, body: unknown): Promise<ApiReply> {
    const res = await fetch(`${this.baseUrl.replace(/\/$/, '')}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Bot-Secret': this.botSecret },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
    });
    const data = (await res.json().catch(() => ({}))) as { message?: string };
    if (res.ok) return { ok: true, message: data.message ?? 'Готово' };
    if (res.status >= 500 || res.status === 401) throw new Error(`API ${path} returned ${res.status}`);
    return { ok: false, message: data.message ?? 'Не получилось' };
  }

  jobAction(jobId: string, telegramId: number, action: 'accept' | 'decline' | 'complete') {
    return this.post(`/bot/jobs/${jobId}/action`, { telegramId, action });
  }

  rateJob(jobId: string, telegramId: number, rating: number) {
    return this.post(`/bot/jobs/${jobId}/rate`, { telegramId, rating });
  }

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
