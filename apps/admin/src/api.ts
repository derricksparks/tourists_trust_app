import type {
  AdminCountry,
  CountryCreateInput,
  CountryUpdateInput,
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
  InsurerCreateInput,
  InsurerUpdateInput,
  InviteStats,
  DmcDecisionInput,
  DmcStatus,
  FamTripInput,
  FamTripParticipantInput,
  FamTripStatus,
  OperatorScoreBreakdown,
  QuoteStatus,
  ReviewInviteCreateInput,
  ReviewInviteState,
  TranslationJobStatus,
  TranslatorDecisionInput,
  TranslatorStatus,
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
  submittedAt: string | null;
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

export interface OperatorDocument {
  id: string; type: string; originalFilename: string; contentType: string; sizeBytes: number;
  reviewNotes: string | null; reviewedAt: string | null; createdAt: string;
}

export interface OperatorDetail extends Operator {
  country: CountryOption & { licenceRegisterUrl: string | null };
  documents: OperatorDocument[];
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

export interface Translator {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  telegramUsername: string | null;
  languages: string[];
  proficiency: Record<string, string>;
  specialtyCountryCode: string;
  specialties: string[];
  bioRu: string | null;
  verificationStatus: TranslatorStatus;
  spotCheckNotes: string | null;
  spotCheckedAt: string | null;
  spotCheckedBy: { name: string } | null;
  jobsCompleted: number;
  rating: string | null;
  createdAt: string;
  telegramUser: { username: string | null } | null;
  _count?: { jobs: number };
}

export interface TranslationJob {
  id: string;
  type: 'DOCUMENT' | 'LIVE';
  status: TranslationJobStatus;
  requesterType: 'TOURIST' | 'OPERATOR' | 'DMC';
  sourceLanguage: string;
  targetLanguage: string;
  description: string | null;
  deadline: string | null;
  scheduledAt: string | null;
  rating: number | null;
  completedAt: string | null;
  createdAt: string;
  translator: { id: string; name: string; telegramUser: { username: string | null } | null } | null;
  requesterTelegramUser: { username: string | null; firstName: string | null; lastName: string | null } | null;
  requesterOperator: { id: string; name: string } | null;
  requesterDmc: { id: string; name: string } | null;
}

export interface Insurer {
  id: string;
  name: string;
  nameRu: string | null;
  websiteUrl: string | null;
  countriesCovered: string[];
  claimsContact: string;
  repatriationConfirmed: boolean;
  coverageRu: string | null;
  exclusionsRu: string | null;
  medicalLimitInfo: string | null;
  notes: string | null;
  published: boolean;
  verifiedAt: string | null;
  verifiedBy: { name: string } | null;
}

export interface ReviewInvite {
  id: string;
  recipientName: string;
  recipientContact: string;
  tripDate: string;
  expiresAt: string;
  usedAt: string | null;
  revokedAt: string | null;
  inquiryId: string | null;
  createdAt: string;
  state: ReviewInviteState;
  operator: { id: string; name: string };
  package: { title: string } | null;
  review: { id: string; status: string; rating: number } | null;
  issuedBy: { name: string };
}

export interface PortalAccount { id: string; email: string; role: string; active: boolean; lastLoginAt: string | null; createdAt: string }

export interface Dmc {
  id: string; name: string; legalName: string | null; websiteUrl: string | null; contactName: string | null; email: string | null;
  phone: string | null; telegramUsername: string | null; status: DmcStatus; statusReason: string | null; createdAt: string;
  accounts: PortalAccount[]; _count: { quoteRequests: number; listings: number };
}

export interface AdminQuote {
  id: string; status: QuoteStatus; pax: number | null; travelStartDate: string | null; notes: string | null; quotedPrice: string | null;
  quotedCurrency: string | null; quotedAt: string | null; closedAt: string | null; createdAt: string;
  dmc: { id: string; name: string };
  package: { id: string; title: string; operator: { id: string; name: string; email: string | null; phone: string | null } };
}

export interface FamTripRow {
  id: string; title: string; startDate: string; endDate: string; status: FamTripStatus; capacity: number | null;
  _count: { dmcs: number; operators: number }; dmcs: { confirmed: boolean }[];
}
export interface FamTripDetail {
  id: string; title: string; startDate: string; endDate: string; status: FamTripStatus; capacity: number | null; notes: string | null;
  itinerary: { day: number; titleRu: string; detailsRu?: string; operatorId?: string }[];
  dmcs: { dmcId: string; confirmed: boolean; representativeName: string | null; dmc: { id: string; name: string; status: DmcStatus; contactName: string | null; email: string | null; phone: string | null } }[];
  operators: { operatorId: string; confirmed: boolean; role: string | null; operator: { id: string; name: string; countryCode: string; email: string | null; phone: string | null } }[];
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

/** A set-password link; `emailed` says whether the API emailed it to the partner. */
type EmailedLink = { link: string; emailed: boolean; emailError?: string };

export const api = {
  login: (email: string, password: string) => request<AdminLoginResult>('POST', '/admin/auth/login', { email, password }),
  me: () => request<AdminProfile>('GET', '/admin/auth/me'),
  stats: () => request<AdminStats>('GET', '/admin/stats'),
  countries: () => request<AdminCountry[]>('GET', '/admin/countries'),
  createCountry: (body: CountryCreateInput) => request<AdminCountry>('POST', '/admin/countries', body),
  updateCountry: (code: string, body: CountryUpdateInput) => request<AdminCountry>('PATCH', `/admin/countries/${code}`, body),
  /** Opens an operator's uploaded document in a new tab (needs the admin token, so it is fetched). */
  openDocument: async (operatorId: string, id: string) => {
    const res = await fetch(`/api/admin/operators/${operatorId}/documents/${id}/file`, { headers: { Authorization: `Bearer ${tokenStore.get()}` } });
    if (!res.ok) throw new ApiError(res.status, res.status === 403 ? 'Only moderators can open documents' : 'Could not open the file');
    window.open(URL.createObjectURL(await res.blob()), '_blank', 'noopener');
  },
  reviewDocument: (operatorId: string, id: string, notes: string) => request<OperatorDocument>('POST', `/admin/operators/${operatorId}/documents/${id}/review`, { notes }),

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

  translators: (status?: TranslatorStatus) => request<Translator[]>('GET', `/admin/translators${qs({ status })}`),
  decideTranslator: (id: string, body: TranslatorDecisionInput) => request<Translator>('POST', `/admin/translators/${id}/decision`, body),
  translationJobs: (p: { status?: TranslationJobStatus; page?: number }) => request<Paginated<TranslationJob>>('GET', `/admin/translation-jobs${qs(p)}`),
  assignJob: (id: string, translatorId: string) => request<{ job: TranslationJob; offerDelivered: boolean }>('POST', `/admin/translation-jobs/${id}/assign`, { translatorId }),
  cancelJob: (id: string, reason: string) => request<TranslationJob>('POST', `/admin/translation-jobs/${id}/cancel`, { reason }),

  insurers: () => request<Insurer[]>('GET', '/admin/insurers'),
  insurer: (id: string) => request<Insurer>('GET', `/admin/insurers/${id}`),
  createInsurer: (body: InsurerCreateInput) => request<Insurer>('POST', '/admin/insurers', body),
  updateInsurer: (id: string, body: InsurerUpdateInput) => request<Insurer>('PATCH', `/admin/insurers/${id}`, body),

  reviewInvites: (operatorId?: string) => request<ReviewInvite[]>('GET', `/admin/review-invites${qs({ operatorId })}`),
  inviteStats: (operatorId: string) => request<InviteStats>('GET', `/admin/operators/${operatorId}/invite-stats`),
  createInvite: (body: Partial<ReviewInviteCreateInput>) =>
    request<{ invite: ReviewInvite; link: string; sentInTelegram: boolean }>('POST', '/admin/review-invites', body),
  revokeInvite: (id: string) => request<{ ok: true }>('POST', `/admin/review-invites/${id}/revoke`),

  dmcs: (status?: DmcStatus) => request<Dmc[]>('GET', `/admin/dmcs${qs({ status })}`),
  decideDmc: (id: string, body: DmcDecisionInput) => request<Dmc>('POST', `/admin/dmcs/${id}/decision`, body),
  operatorAccounts: (operatorId: string) => request<PortalAccount[]>('GET', `/admin/operators/${operatorId}/accounts`),
  createOperatorAccount: (operatorId: string, email: string) => request<{ account: PortalAccount } & EmailedLink>('POST', `/admin/operators/${operatorId}/accounts`, { email }),
  passwordLink: (accountId: string) => request<EmailedLink>('POST', `/admin/accounts/${accountId}/password-link`),
  setAccountActive: (accountId: string, active: boolean) => request<PortalAccount>('POST', `/admin/accounts/${accountId}/active`, { active }),
  operatorScores: (operatorId: string) => request<OperatorScoreBreakdown>('GET', `/admin/operators/${operatorId}/scores`),
  quotes: (status?: QuoteStatus) => request<AdminQuote[]>('GET', `/admin/quotes${qs({ status })}`),
  famTrips: () => request<FamTripRow[]>('GET', '/admin/fam-trips'),
  famTrip: (id: string) => request<FamTripDetail>('GET', `/admin/fam-trips/${id}`),
  createFamTrip: (body: FamTripInput) => request<FamTripDetail>('POST', '/admin/fam-trips', body),
  updateFamTrip: (id: string, body: FamTripInput) => request<FamTripDetail>('PATCH', `/admin/fam-trips/${id}`, body),
  upsertParticipant: (id: string, body: FamTripParticipantInput) => request<FamTripDetail>('POST', `/admin/fam-trips/${id}/participants`, body),
  removeParticipant: (id: string, kind: 'dmc' | 'operator', participantId: string) => request<FamTripDetail>('DELETE', `/admin/fam-trips/${id}/participants/${kind}/${participantId}`),

  reviews: (p: { status?: ReviewStatus; page?: number }) => request<Paginated<Review>>('GET', `/admin/reviews${qs(p)}`),
  decideReview: (id: string, body: ReviewDecisionInput) => request<Review>('POST', `/admin/reviews/${id}/decision`, body),
};
