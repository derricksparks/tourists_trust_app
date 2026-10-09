import type {
  AdminLoginResult,
  AdminRole,
  AdminStats,
  CountryOption,
  OperatorCreateInput,
  OperatorDecisionInput,
  OperatorStatus,
  OperatorUpdateInput,
  Paginated,
  ReviewDecisionInput,
  ReviewStatus,
} from '@ttp/shared-types';

// Response shapes as the API serialises them (dates arrive as ISO strings).

export interface Operator {
  id: string;
  slug: string;
  name: string;
  legalName: string | null;
  countryCode: string;
  businessRegNumber: string;
  tourismBoardLicense: string;
  licensingAuthority: string;
  address: string;
  yearEstablished: number | null;
  referenceContactName: string | null;
  referenceContactInfo: string | null;
  websiteUrl: string | null;
  email: string | null;
  phone: string | null;
  telegramUsername: string | null;
  descriptionRu: string | null;
  descriptionEn: string | null;
  status: OperatorStatus;
  statusReason: string | null;
  verificationVideoUrl: string | null;
  responseTimeScore: number | null;
  completenessScore: number | null;
  badgeToken: string;
  approvedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface HistoryEntry {
  id: string;
  action: string;
  reason: string | null;
  createdAt: string;
  actorAdmin: { id: string; name: string } | null;
}

export interface OperatorDetail extends Operator {
  country: CountryOption;
  documents: { id: string; type: string; originalFilename: string; reviewNotes: string | null; createdAt: string }[];
  media: { id: string; kind: string; externalUrl: string | null; captionRu: string | null; status: string }[];
  history: HistoryEntry[];
}

export interface Review {
  id: string;
  authorName: string;
  rating: number;
  ratingGuide: number | null;
  ratingVehicle: number | null;
  ratingAccommodation: number | null;
  ratingValue: number | null;
  bodyRu: string | null;
  bodyEn: string | null;
  originalLanguage: string;
  tripDate: string;
  status: ReviewStatus;
  rejectionReason: string | null;
  moderatedAt: string | null;
  createdAt: string;
  operator: { id: string; name: string; slug: string; countryCode: string };
  package: { id: string; title: string } | null;
  invite: { recipientName: string; recipientContact: string; tripDate: string; createdAt: string };
  moderatedBy: { id: string; name: string } | null;
}

export interface AdminProfile {
  id: string;
  name: string;
  email: string;
  role: AdminRole;
}

/** An error the API returned, with the field-level messages from validation when there are any. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly fieldErrors: { path: string; message: string }[] = [],
  ) {
    super(message);
  }
}

const TOKEN_KEY = 'ttp-admin-token';

// sessionStorage: the login ends when the tab closes, which suits a shared office machine.
export const tokenStore = {
  get: () => {
    try {
      return sessionStorage.getItem(TOKEN_KEY);
    } catch {
      return null;
    }
  },
  set: (token: string | null) => {
    try {
      if (token) sessionStorage.setItem(TOKEN_KEY, token);
      else sessionStorage.removeItem(TOKEN_KEY);
    } catch {
      /* storage unavailable: the session lasts until reload */
    }
  },
};

let onUnauthorized: () => void = () => {};
/** Called when the API rejects the token (expired, or the admin was deactivated). */
export function setUnauthorizedHandler(fn: () => void) {
  onUnauthorized = fn;
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const token = tokenStore.get();
  const res = await fetch(`/api${path}`, {
    method,
    headers: {
      ...(body !== undefined && { 'Content-Type': 'application/json' }),
      ...(token && { Authorization: `Bearer ${token}` }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = res.status === 204 ? undefined : await res.json().catch(() => undefined);
  if (!res.ok) {
    if (res.status === 401 && path !== '/admin/auth/login') onUnauthorized();
    const message = Array.isArray(data?.message) ? data.message.join(', ') : data?.message ?? `Request failed (${res.status})`;
    throw new ApiError(res.status, message, data?.errors ?? []);
  }
  return data as T;
}

const qs = (params: Record<string, string | number | undefined>) => {
  const entries = Object.entries(params).filter(([, v]) => v !== undefined && v !== '') as [string, string][];
  return entries.length ? `?${new URLSearchParams(entries)}` : '';
};

export const api = {
  login: (email: string, password: string) => request<AdminLoginResult>('POST', '/admin/auth/login', { email, password }),
  me: () => request<AdminProfile>('GET', '/admin/auth/me'),
  stats: () => request<AdminStats>('GET', '/admin/stats'),
  countries: () => request<CountryOption[]>('GET', '/admin/countries'),

  operators: (p: { status?: OperatorStatus; countryCode?: string; q?: string; page?: number }) =>
    request<Paginated<Operator>>('GET', `/admin/operators${qs(p)}`),
  operator: (id: string) => request<OperatorDetail>('GET', `/admin/operators/${id}`),
  createOperator: (body: OperatorCreateInput) => request<Operator>('POST', '/admin/operators', body),
  updateOperator: (id: string, body: OperatorUpdateInput) => request<Operator>('PATCH', `/admin/operators/${id}`, body),
  decideOperator: (id: string, body: OperatorDecisionInput) => request<Operator>('POST', `/admin/operators/${id}/decision`, body),

  reviews: (p: { status?: ReviewStatus; page?: number }) => request<Paginated<Review>>('GET', `/admin/reviews${qs(p)}`),
  decideReview: (id: string, body: ReviewDecisionInput) => request<Review>('POST', `/admin/reviews/${id}/decision`, body),
};
