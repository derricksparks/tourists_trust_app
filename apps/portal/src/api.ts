import type {
  DmcListingInput,
  DmcSignupInput,
  FamTripStatus,
  OperatorScoreBreakdown,
  OperatorStatus,
  PackageInput,
  PackageStatus,
  PortalLoginResult,
  PortalProfile,
  QuoteRequestCreateInput,
  QuoteResponseInput,
  QuoteStatus,
} from '@ttp/shared-types';

export interface DateRange { id: string; startDate: string; endDate: string; capacity: number | null }
export interface OperatorPackage {
  id: string; slug: string; title: string; titleRu: string | null; descriptionEn: string | null; descriptionRu: string | null;
  countryCode: string; durationDays: number; price: string | null; currency: string | null; priceBasis: 'PER_PERSON' | 'PER_GROUP';
  capacity: number | null; inclusions: string[]; exclusions: string[]; status: PackageStatus; updatedAt: string;
  dateRanges: DateRange[]; _count: { quoteRequests: number; listings: number };
}
export interface OperatorOverview {
  operator: { id: string; name: string; slug: string; status: OperatorStatus; statusReason: string | null };
  scores: OperatorScoreBreakdown;
  openQuotes: number;
  packagesByStatus: Partial<Record<PackageStatus, number>>;
  upcomingFamTrips: number;
}
export interface Quote {
  id: string; status: QuoteStatus; pax: number | null; travelStartDate: string | null; travelEndDate: string | null; notes: string | null;
  quotedPrice: string | null; quotedCurrency: string | null; quoteTerms: string | null; quotedAt: string | null; closedAt: string | null; createdAt: string;
  package: { id: string; title: string; titleRu?: string | null; slug?: string; durationDays: number; operator?: { name: string; slug: string } };
  dmc?: { name: string; websiteUrl: string | null; contactName: string | null; email: string | null; phone: string | null };
}
export interface InventoryItem {
  id: string; slug: string; title: string; titleRu: string | null; descriptionRu: string | null; countryCode: string; durationDays: number;
  price: string | null; currency: string | null; priceBasis: 'PER_PERSON' | 'PER_GROUP'; capacity: number | null; inclusions: string[]; exclusions: string[];
  dateRanges: DateRange[]; listedByMe: boolean;
  operator: { id: string; name: string; slug: string; countryCode: string; licensingAuthority: string; approvedAt: string | null; yearEstablished: number | null; responseTimeScore: number | null };
}
export interface Listing {
  id: string; whiteLabelTitle: string | null; dmcPageUrl: string | null; active: boolean; sellable: boolean; mirrorUrl: string; whiteLabelText: string;
  package: InventoryItem;
}
export interface FamTripParticipantOp { famTripId: string; confirmed: boolean; role: string | null; famTrip: FamTrip & { dmcs: { dmc: { name: string } }[] } }
export interface FamTrip {
  id: string; title: string; startDate: string; endDate: string; status: FamTripStatus; capacity: number | null; notes: string | null;
  itinerary: { day: number; titleRu: string; detailsRu?: string; operatorId?: string }[];
}
export interface DmcFamTrip extends FamTrip {
  operators: { operator: { name: string; slug: string; countryCode: string }; role: string | null }[];
  seatsTaken: number; myStatus: 'requested' | 'confirmed' | null; myRepresentative: string | null;
}

export class ApiError extends Error {
  constructor(readonly status: number, message: string, readonly fieldErrors: { path: string; message: string }[] = []) {
    super(message);
  }
}

const TOKEN_KEY = 'ttp-portal-token';
// Partners use their own computers, so the login is remembered until it expires (12 hours).
export const tokenStore = {
  get: () => { try { return localStorage.getItem(TOKEN_KEY); } catch { return null; } },
  set: (t: string | null) => { try { if (t) localStorage.setItem(TOKEN_KEY, t); else localStorage.removeItem(TOKEN_KEY); } catch { /* not persisted */ } },
};

let onUnauthorized: () => void = () => {};
export const setUnauthorizedHandler = (fn: () => void) => { onUnauthorized = fn; };

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const token = tokenStore.get();
  const res = await fetch(`/api${path}`, {
    method,
    headers: { ...(body !== undefined && { 'Content-Type': 'application/json' }), ...(token && { Authorization: `Bearer ${token}` }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => undefined);
  if (!res.ok) {
    if (res.status === 401 && !path.startsWith('/portal/auth/')) onUnauthorized();
    throw new ApiError(res.status, Array.isArray(data?.message) ? data.message.join(', ') : data?.message ?? `Request failed (${res.status})`, data?.errors ?? []);
  }
  return data as T;
}

const qs = (p: Record<string, string | number | undefined>) => {
  const e = Object.entries(p).filter(([, v]) => v !== undefined && v !== '') as [string, string][];
  return e.length ? `?${new URLSearchParams(e)}` : '';
};

export const api = {
  login: (email: string, password: string) => request<PortalLoginResult>('POST', '/portal/auth/login', { email, password }),
  setPassword: (token: string, password: string) => request<PortalLoginResult>('POST', '/portal/auth/set-password', { token, password }),
  me: () => request<PortalProfile>('GET', '/portal/auth/me'),
  dmcSignup: (body: DmcSignupInput) => request<PortalLoginResult>('POST', '/portal/dmc-signup', body),

  // Operator
  overview: () => request<OperatorOverview>('GET', '/portal/operator/overview'),
  packages: () => request<OperatorPackage[]>('GET', '/portal/operator/packages'),
  package: (id: string) => request<OperatorPackage>('GET', `/portal/operator/packages/${id}`),
  createPackage: (body: PackageInput) => request<OperatorPackage>('POST', '/portal/operator/packages', body),
  updatePackage: (id: string, body: PackageInput) => request<OperatorPackage>('PATCH', `/portal/operator/packages/${id}`, body),
  setPackageStatus: (id: string, status: PackageStatus) => request<OperatorPackage>('POST', `/portal/operator/packages/${id}/status`, { status }),
  operatorQuotes: () => request<Quote[]>('GET', '/portal/operator/quotes'),
  respondQuote: (id: string, body: QuoteResponseInput) => request<Quote>('POST', `/portal/operator/quotes/${id}/respond`, body),
  operatorFamTrips: () => request<FamTripParticipantOp[]>('GET', '/portal/operator/fam-trips'),
  confirmFamTrip: (id: string) => request<{ ok: true }>('POST', `/portal/operator/fam-trips/${id}/confirm`),

  // DMC
  inventory: (p: { country?: string; q?: string; maxDays?: number; month?: string }) => request<InventoryItem[]>('GET', `/portal/dmc/inventory${qs(p)}`),
  requestQuote: (body: QuoteRequestCreateInput) => request<Quote>('POST', '/portal/dmc/quotes', body),
  dmcQuotes: () => request<Quote[]>('GET', '/portal/dmc/quotes'),
  closeQuote: (id: string, outcome: 'booked' | 'not_booked') => request<{ ok: true }>('POST', `/portal/dmc/quotes/${id}/close`, { outcome }),
  listings: () => request<Listing[]>('GET', '/portal/dmc/listings'),
  saveListing: (body: DmcListingInput) => request<unknown>('POST', '/portal/dmc/listings', body),
  removeListing: (id: string) => request<{ ok: true }>('DELETE', `/portal/dmc/listings/${id}`),
  dmcFamTrips: () => request<DmcFamTrip[]>('GET', '/portal/dmc/fam-trips'),
  joinFamTrip: (id: string, representativeName: string) => request<{ ok: true }>('POST', `/portal/dmc/fam-trips/${id}/join`, { representativeName }),
};
