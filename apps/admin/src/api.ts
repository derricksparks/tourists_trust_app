import type {
  AdminLoginResult,
  AdminRole,
  AdminStats,
  ChecklistItem,
  ContentStatus,
  CountryOption,
  DestinationGuideCreateInput,
  DestinationGuideUpdateInput,
  GuideKind,
  InquiryStatus,
  OperatorCreateInput,
  OperatorDecisionInput,
  OperatorStatus,
  OperatorUpdateInput,
  Paginated,
  ReviewDecisionInput,
  ReviewStatus,
  VisaGuideCreateInput,
  VisaGuideUpdateInput,
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

export interface Inquiry {
  id: string;
  channel: 'TELEGRAM' | 'WEB';
  contactName: string | null;
  contactInfo: string | null;
  message: string;
  travelMonth: string | null;
  groupSize: number | null;
  status: InquiryStatus;
  firstResponseAt: string | null;
  createdAt: string;
  operator: { id: string; name: string; slug: string; email: string | null; phone: string | null; telegramUsername: string | null; websiteUrl: string | null };
  package: { title: string; titleRu: string | null } | null;
  telegramUser: { username: string | null; firstName: string | null; lastName: string | null; languageCode: string | null } | null;
}

export interface VisaGuide {
  id: string;
  slug: string;
  countryCode: string;
  coveredCountries: string[];
  visaType: string;
  titleRu: string;
  requirementsRu: string;
  checklistItems: ChecklistItem[];
  officialUrl: string | null;
  feeInfo: string | null;
  processingTime: string | null;
  status: ContentStatus;
  lastUpdated: string;
  updatedAt: string;
}

export interface DestinationGuide {
  id: string;
  slug: string;
  countryCode: string;
  kind: GuideKind;
  titleRu: string;
  summaryRu: string | null;
  bodyRu: string;
  titleEn: string | null;
  bodyEn: string | null;
  status: ContentStatus;
  publishedAt: string | null;
  lastUpdated: string;
  updatedAt: string;
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

  inquiries: (p: { status?: InquiryStatus; page?: number }) => request<Paginated<Inquiry>>('GET', `/admin/inquiries${qs(p)}`),
  replyToInquiry: (id: string, text: string) => request<Inquiry>('POST', `/admin/inquiries/${id}/reply`, { text }),
  setInquiryStatus: (id: string, status: 'RESPONDED' | 'CLOSED') => request<Inquiry>('POST', `/admin/inquiries/${id}/status`, { status }),

  visaGuides: () => request<VisaGuide[]>('GET', '/admin/visa-guides'),
  visaGuide: (id: string) => request<VisaGuide>('GET', `/admin/visa-guides/${id}`),
  createVisaGuide: (body: VisaGuideCreateInput) => request<VisaGuide>('POST', '/admin/visa-guides', body),
  updateVisaGuide: (id: string, body: VisaGuideUpdateInput) => request<VisaGuide>('PATCH', `/admin/visa-guides/${id}`, body),

  guides: () => request<DestinationGuide[]>('GET', '/admin/guides'),
  guide: (id: string) => request<DestinationGuide>('GET', `/admin/guides/${id}`),
  createGuide: (body: DestinationGuideCreateInput) => request<DestinationGuide>('POST', '/admin/guides', body),
  updateGuide: (id: string, body: DestinationGuideUpdateInput) => request<DestinationGuide>('PATCH', `/admin/guides/${id}`, body),

  reviews: (p: { status?: ReviewStatus; page?: number }) => request<Paginated<Review>>('GET', `/admin/reviews${qs(p)}`),
  decideReview: (id: string, body: ReviewDecisionInput) => request<Review>('POST', `/admin/reviews/${id}/decision`, body),
};
