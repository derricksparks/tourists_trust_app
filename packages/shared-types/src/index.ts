import { z } from 'zod';

// Enum values shared by every app. They mirror the Prisma enums in
// services/api/prisma/schema.prisma; a test in services/api keeps them in sync.

export const OPERATOR_STATUSES = ['PENDING', 'APPROVED', 'REJECTED', 'FLAGGED', 'SUSPENDED'] as const;
export type OperatorStatus = (typeof OPERATOR_STATUSES)[number];

export const ADMIN_ROLES = ['SUPER_ADMIN', 'MODERATOR', 'CONTENT_EDITOR'] as const;
export type AdminRole = (typeof ADMIN_ROLES)[number];

export const REVIEW_STATUSES = ['PENDING', 'PUBLISHED', 'REJECTED'] as const;
export type ReviewStatus = (typeof REVIEW_STATUSES)[number];

/** Countries the platform launches with (operators) plus Russia (demand side). */
export const LAUNCH_COUNTRIES = ['UG', 'TZ', 'KE'] as const;

// ─── Admin API: auth ─────────────────────────────────────────────────────────

export const adminLoginSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(1),
});
export type AdminLoginInput = z.infer<typeof adminLoginSchema>;

export interface AdminLoginResult {
  accessToken: string;
  admin: { id: string; name: string; email: string; role: AdminRole };
}

// ─── Admin API: operators ────────────────────────────────────────────────────

const optionalText = z.string().trim().min(1).optional();
const countryCode = z.string().trim().toUpperCase().regex(/^[A-Z]{2}$/, 'ISO 3166-1 alpha-2 code');

const operatorRequiredFields = {
  name: z.string().trim().min(2),
  countryCode,
  businessRegNumber: z.string().trim().min(1),
  tourismBoardLicense: z.string().trim().min(1),
  licensingAuthority: z.string().trim().min(1),
  address: z.string().trim().min(1),
};

const operatorOptionalFields = {
  legalName: optionalText,
  yearEstablished: z.number().int().min(1900).max(new Date().getFullYear()).optional(),
  referenceContactName: optionalText,
  referenceContactInfo: optionalText,
  websiteUrl: z.string().trim().url().optional(),
  email: z.string().trim().toLowerCase().email().optional(),
  phone: optionalText,
  telegramUsername: optionalText,
  descriptionRu: optionalText,
  descriptionEn: optionalText,
  verificationVideoUrl: z.string().trim().url().optional(),
};

/** Manual operator entry by staff (Phase 0); the same fields later back the intake form. */
export const operatorCreateSchema = z.object({ ...operatorRequiredFields, ...operatorOptionalFields });
export type OperatorCreateInput = z.infer<typeof operatorCreateSchema>;

function nullableShape<T extends z.ZodRawShape>(shape: T) {
  return Object.fromEntries(Object.entries(shape).map(([k, v]) => [k, v.nullable()])) as {
    [K in keyof T]: z.ZodNullable<T[K]>;
  };
}

/** Partial update. An omitted field is left alone; null clears an optional field. */
export const operatorUpdateSchema = z
  .object({ ...operatorRequiredFields, ...nullableShape(operatorOptionalFields) })
  .partial();
export type OperatorUpdateInput = z.infer<typeof operatorUpdateSchema>;

export const OPERATOR_DECISIONS = ['approve', 'reject', 'flag', 'suspend'] as const;
export type OperatorDecision = (typeof OPERATOR_DECISIONS)[number];

/**
 * The operator approval workflow (spec TV-2). Each decision moves an operator into one
 * status and is only allowed from the listed statuses:
 *
 *   PENDING ──approve──▶ APPROVED ──suspend──▶ SUSPENDED ──approve──▶ APPROVED
 *      │  ╲──flag──▶ FLAGGED ──approve / reject
 *      ╰──reject──▶ REJECTED (final; a rejected operator re-applies as a new record)
 */
export const OPERATOR_TRANSITIONS: Record<OperatorDecision, { from: readonly OperatorStatus[]; to: OperatorStatus }> = {
  approve: { from: ['PENDING', 'FLAGGED', 'SUSPENDED'], to: 'APPROVED' },
  reject: { from: ['PENDING', 'FLAGGED'], to: 'REJECTED' },
  flag: { from: ['PENDING'], to: 'FLAGGED' },
  suspend: { from: ['APPROVED'], to: 'SUSPENDED' },
};

/** A reason is required for every decision except approve; it is kept in the audit log. */
export const operatorDecisionSchema = z
  .object({
    decision: z.enum(OPERATOR_DECISIONS),
    reason: optionalText,
  })
  .refine((d) => d.decision === 'approve' || !!d.reason, {
    message: 'A reason is required to reject, flag or suspend an operator',
    path: ['reason'],
  });
export type OperatorDecisionInput = z.infer<typeof operatorDecisionSchema>;

export const operatorListQuerySchema = z.object({
  status: z.enum(OPERATOR_STATUSES).optional(),
  countryCode: countryCode.optional(),
  q: z.string().trim().min(1).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});
export type OperatorListQuery = z.infer<typeof operatorListQuerySchema>;

export interface Paginated<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

// ─── Admin API: reviews ──────────────────────────────────────────────────────

export const REVIEW_DECISIONS = ['publish', 'reject'] as const;
export type ReviewDecision = (typeof REVIEW_DECISIONS)[number];

/**
 * Review moderation (spec TV-5). Reviews arrive PENDING through an invite link.
 * A published review can later be taken down (rejected) if a problem comes to light.
 */
export const REVIEW_TRANSITIONS: Record<ReviewDecision, { from: readonly ReviewStatus[]; to: ReviewStatus }> = {
  publish: { from: ['PENDING'], to: 'PUBLISHED' },
  reject: { from: ['PENDING', 'PUBLISHED'], to: 'REJECTED' },
};

/** Rejecting (or taking down a published review) needs a reason for the audit log. */
export const reviewDecisionSchema = z
  .object({
    decision: z.enum(REVIEW_DECISIONS),
    reason: optionalText,
  })
  .refine((d) => d.decision === 'publish' || !!d.reason, {
    message: 'A reason is required to reject a review',
    path: ['reason'],
  });
export type ReviewDecisionInput = z.infer<typeof reviewDecisionSchema>;

export const reviewListQuerySchema = z.object({
  status: z.enum(REVIEW_STATUSES).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});
export type ReviewListQuery = z.infer<typeof reviewListQuerySchema>;

// ─── Admin API: dashboard ────────────────────────────────────────────────────

/** Basic analytics (spec AD-2) plus the work waiting for moderators. */
export interface AdminStats {
  operatorsByStatus: Record<OperatorStatus, number>;
  reviewsPending: number;
  inquiriesNew: number;
  translatorsPending: number;
  translationJobsOpen: number; // REQUESTED: waiting for staff to find a translator
  listingsLive: number; // published packages from approved operators
  dmcsOnboarded: number; // approved DMCs
  quoteRequests: number;
  translatorJobsCompleted: number;
}

export interface CountryOption {
  code: string;
  nameEn: string;
  nameRu: string;
}

// ─── Public API (website, Telegram bot, Mini App) ────────────────────────────

export interface PublicOperatorSummary {
  slug: string;
  name: string;
  countryCode: string;
  licensingAuthority: string;
  yearEstablished: number | null;
  descriptionRu: string | null;
  verifiedSince: string | null;
  reviewCount: number;
  averageRating: number | null;
  packageCount: number;
}

export interface PublicPackage {
  slug: string;
  title: string;
  titleRu: string | null;
  descriptionRu: string | null;
  durationDays: number;
  price: string | null; // decimal as string, display only
  currency: string | null;
  priceBasis: 'PER_PERSON' | 'PER_GROUP';
  capacity: number | null;
  inclusions: string[];
  exclusions: string[];
  dates: { startDate: string; endDate: string; capacity: number | null }[];
}

export interface PublicReview {
  id: string;
  authorName: string;
  rating: number;
  bodyRu: string | null;
  bodyEn: string | null;
  tripDate: string;
  packageTitle: string | null;
  operatorReply: string | null;
}

export interface PublicOperatorDetail extends PublicOperatorSummary {
  descriptionEn: string | null;
  tourismBoardLicense: string;
  businessRegNumber: string;
  websiteUrl: string | null;
  verificationVideoUrl: string | null;
  telegramUsername: string | null;
  responseTimeScore: number | null;
  completenessScore: number | null;
  country: CountryOption;
  packages: PublicPackage[];
  reviews: PublicReview[];
}

export interface PublicCountry extends CountryOption {
  operatorCount: number;
}

/** What the embeddable badge shows. Non-approved operators are all "not_verified" so nothing leaks. */
export type BadgeState = 'verified' | 'revoked' | 'not_verified';
export interface BadgeStatus {
  state: BadgeState;
  operator?: { name: string; slug: string; countryCode: string; licensingAuthority: string; verifiedSince: string | null };
}

export interface ChecklistItem {
  key: string;
  labelRu: string;
  required: boolean;
}

export interface PublicVisaGuide {
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
  lastUpdated: string;
}

export const GUIDE_KINDS = ['DESTINATION', 'LOGISTICS'] as const;
export type GuideKind = (typeof GUIDE_KINDS)[number];

export interface PublicDestinationGuide {
  slug: string;
  countryCode: string;
  kind: GuideKind;
  titleRu: string;
  summaryRu: string | null;
  bodyRu: string;
  lastUpdated: string;
  publishedAt: string | null;
}

/** "Request info" sent from the Telegram Mini App. The sender is identified by Telegram initData. */
export const inquiryCreateSchema = z.object({
  operatorSlug: z.string().trim().min(1),
  packageSlug: z.string().trim().min(1).optional(),
  message: z.string().trim().min(10, 'Напишите хотя бы пару предложений').max(2000),
  travelMonth: z
    .string()
    .regex(/^\d{4}-(0[1-9]|1[0-2])$/)
    .optional(),
  groupSize: z.number().int().min(1).max(100).optional(),
  consent: z.literal(true, { errorMap: () => ({ message: 'Нужно согласие на передачу данных туроператору' }) }),
});
export type InquiryCreateInput = z.infer<typeof inquiryCreateSchema>;

// ─── Admin API: inquiries ────────────────────────────────────────────────────

export const INQUIRY_STATUSES = ['NEW', 'RESPONDED', 'CLOSED'] as const;
export type InquiryStatus = (typeof INQUIRY_STATUSES)[number];

export const inquiryListQuerySchema = z.object({
  status: z.enum(INQUIRY_STATUSES).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});
export type InquiryListQuery = z.infer<typeof inquiryListQuerySchema>;

/** Staff mark an inquiry once the operator has replied (sets first_response_at) or it is done. */
export const inquiryStatusSchema = z.object({ status: z.enum(['RESPONDED', 'CLOSED']) });
export type InquiryStatusInput = z.infer<typeof inquiryStatusSchema>;

/** A reply typed by staff, sent to the traveller through the bot. */
export const inquiryReplySchema = z.object({ text: z.string().trim().min(2).max(3500) });
export type InquiryReplyInput = z.infer<typeof inquiryReplySchema>;

// ─── Admin API: content (visa guides, destination guides) ────────────────────

export const CONTENT_STATUSES = ['DRAFT', 'PUBLISHED'] as const;
export type ContentStatus = (typeof CONTENT_STATUSES)[number];

const slug = z
  .string()
  .trim()
  .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, 'Lowercase letters, digits and hyphens only');

export const checklistItemSchema = z.object({
  key: z.string().trim().regex(/^[a-z0-9_]+$/, 'Lowercase letters, digits and underscores only'),
  labelRu: z.string().trim().min(1),
  required: z.boolean(),
});

export const visaGuideCreateSchema = z.object({
  slug,
  countryCode,
  coveredCountries: z.array(countryCode).min(1),
  visaType: z.string().trim().min(1),
  titleRu: z.string().trim().min(1),
  requirementsRu: z.string().trim().min(1),
  checklistItems: z.array(checklistItemSchema).default([]),
  officialUrl: z.string().trim().url().nullable().optional(),
  feeInfo: z.string().trim().min(1).nullable().optional(),
  processingTime: z.string().trim().min(1).nullable().optional(),
  status: z.enum(CONTENT_STATUSES).default('DRAFT'),
  /** Tick when the facts were re-checked against the official source; bumps last_updated. */
  factsVerified: z.boolean().optional(),
});
export type VisaGuideCreateInput = z.infer<typeof visaGuideCreateSchema>;
export const visaGuideUpdateSchema = visaGuideCreateSchema.partial().omit({ checklistItems: true }).extend({
  checklistItems: z.array(checklistItemSchema).optional(),
});
export type VisaGuideUpdateInput = z.infer<typeof visaGuideUpdateSchema>;

export const destinationGuideCreateSchema = z.object({
  slug,
  countryCode,
  kind: z.enum(GUIDE_KINDS),
  titleRu: z.string().trim().min(1),
  summaryRu: z.string().trim().min(1).nullable().optional(),
  bodyRu: z.string().trim().min(1),
  titleEn: z.string().trim().min(1).nullable().optional(),
  bodyEn: z.string().trim().min(1).nullable().optional(),
  status: z.enum(CONTENT_STATUSES).default('DRAFT'),
  factsVerified: z.boolean().optional(),
});
export type DestinationGuideCreateInput = z.infer<typeof destinationGuideCreateSchema>;
export const destinationGuideUpdateSchema = destinationGuideCreateSchema.partial();
export type DestinationGuideUpdateInput = z.infer<typeof destinationGuideUpdateSchema>;

// ─── Phase 2: translators & guides network (TR-1…TR-4) ───────────────────────

export const TRANSLATOR_STATUSES = ['PENDING', 'VERIFIED', 'REJECTED', 'SUSPENDED'] as const;
export type TranslatorStatus = (typeof TRANSLATOR_STATUSES)[number];

export const TRANSLATOR_DECISIONS = ['verify', 'reject', 'suspend'] as const;
export type TranslatorDecision = (typeof TRANSLATOR_DECISIONS)[number];

/** Verification after a spot-check (TR-1). Suspending removes them from the directory; verifying again restores them. */
export const TRANSLATOR_TRANSITIONS: Record<TranslatorDecision, { from: readonly TranslatorStatus[]; to: TranslatorStatus }> = {
  verify: { from: ['PENDING', 'SUSPENDED'], to: 'VERIFIED' },
  reject: { from: ['PENDING'], to: 'REJECTED' },
  suspend: { from: ['VERIFIED'], to: 'SUSPENDED' },
};

/** Every decision records what was checked or why: e.g. "20-min video call in Russian, fluent". */
export const translatorDecisionSchema = z.object({
  decision: z.enum(TRANSLATOR_DECISIONS),
  notes: z.string().trim().min(3, 'Write what you checked, or why'),
});
export type TranslatorDecisionInput = z.infer<typeof translatorDecisionSchema>;

export const LANGUAGES: Record<string, string> = {
  ru: 'русский', en: 'английский', sw: 'суахили', fr: 'французский', ar: 'арабский',
  lg: 'луганда', rw: 'киньяруанда', de: 'немецкий', it: 'итальянский', zh: 'китайский',
};
export const PROFICIENCY_LEVELS = ['A2', 'B1', 'B2', 'C1', 'C2', 'native'] as const;
export const SPECIALTIES: Record<string, string> = {
  safari_guide: 'гид на сафари',
  city_guide: 'городской гид',
  documents: 'перевод документов',
  live_interpretation: 'устный перевод',
  medical: 'медицина',
  legal: 'юридические вопросы',
  business: 'деловые встречи',
};
const languageCode = z.string().refine((l) => l in LANGUAGES, 'Unknown language');
const specialty = z.string().refine((s) => s in SPECIALTIES, 'Unknown specialty');
const TRANSLATOR_COUNTRIES = ['UG', 'TZ', 'KE', 'RW'] as const;

/** Self sign-up from the Telegram Mini App (TR-1). Proficiency is self-reported; staff spot-check before listing. */
export const translatorSignupSchema = z
  .object({
    name: z.string().trim().min(2).max(100),
    languages: z.array(languageCode).min(2, 'Укажите хотя бы два языка').max(8),
    proficiency: z.record(languageCode, z.enum(PROFICIENCY_LEVELS)),
    specialtyCountryCode: z.enum(TRANSLATOR_COUNTRIES),
    specialties: z.array(specialty).min(1, 'Выберите хотя бы одно направление'),
    bioRu: z.string().trim().max(1000).optional(),
    phone: z.string().trim().max(40).optional(),
    consent: z.literal(true, { errorMap: () => ({ message: 'Нужно согласие на публикацию профиля' }) }),
  })
  .refine((t) => t.languages.includes('ru'), { message: 'Нужен русский язык', path: ['languages'] })
  .refine((t) => t.languages.every((l) => l in t.proficiency), { message: 'Укажите уровень для каждого языка', path: ['proficiency'] });
export type TranslatorSignupInput = z.infer<typeof translatorSignupSchema>;

/** Directory entry (TR-2). No contact details: travellers reach translators through a request. */
export interface PublicTranslator {
  id: string;
  name: string;
  languages: string[];
  proficiency: Record<string, string>;
  specialtyCountryCode: string;
  specialties: string[];
  bioRu: string | null;
  jobsCompleted: number;
  rating: number | null;
}

export const TRANSLATION_JOB_STATUSES = ['REQUESTED', 'ASSIGNED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED'] as const;
export type TranslationJobStatus = (typeof TRANSLATION_JOB_STATUSES)[number];

/**
 * A traveller's request from the Mini App (TR-3), addressed to a translator from the directory.
 * REQUESTED: needs a translator (staff assign) · ASSIGNED: offer sent, waiting for the translator ·
 * IN_PROGRESS: accepted, contacts exchanged · COMPLETED (rated by the traveller) · CANCELLED.
 */
export const translationJobCreateSchema = z
  .object({
    translatorId: z.string().uuid(),
    type: z.enum(['DOCUMENT', 'LIVE']),
    sourceLanguage: languageCode,
    targetLanguage: languageCode,
    description: z.string().trim().min(10, 'Опишите задачу в двух-трёх предложениях').max(2000),
    deadline: z.string().date().optional(),
    scheduledAt: z.string().datetime({ offset: true }).optional(),
    consent: z.literal(true, { errorMap: () => ({ message: 'Нужно согласие на передачу контакта переводчику' }) }),
  })
  .refine((j) => j.sourceLanguage !== j.targetLanguage, { message: 'Языки должны различаться', path: ['targetLanguage'] });
export type TranslationJobCreateInput = z.infer<typeof translationJobCreateSchema>;

export const translationJobListQuerySchema = z.object({
  status: z.enum(TRANSLATION_JOB_STATUSES).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});
export type TranslationJobListQuery = z.infer<typeof translationJobListQuerySchema>;

export const translationJobAssignSchema = z.object({ translatorId: z.string().uuid() });
export const translationJobCancelSchema = z.object({ reason: z.string().trim().min(3) });

/** Button presses in the bot, forwarded by the bot process to the API. */
export const BOT_JOB_ACTIONS = ['accept', 'decline', 'complete'] as const;
export const botJobActionSchema = z.object({ telegramId: z.number().int(), action: z.enum(BOT_JOB_ACTIONS) });
export const botJobRatingSchema = z.object({ telegramId: z.number().int(), rating: z.number().int().min(1).max(5) });

// ─── Phase 2: insurers (IN-1, IN-2) ──────────────────────────────────────────

export const insurerCreateSchema = z.object({
  name: z.string().trim().min(2),
  nameRu: z.string().trim().min(1).nullable().optional(),
  websiteUrl: z.string().trim().url().nullable().optional(),
  countriesCovered: z.array(countryCode).min(1),
  claimsContact: z.string().trim().min(3),
  repatriationConfirmed: z.boolean().default(false),
  coverageRu: z.string().trim().min(1).nullable().optional(),
  exclusionsRu: z.string().trim().min(1).nullable().optional(),
  medicalLimitInfo: z.string().trim().min(1).nullable().optional(),
  notes: z.string().trim().min(1).nullable().optional(),
  published: z.boolean().default(false),
  /** Tick after confirming claims and repatriation capability by direct contact; stamps verified_at. */
  factsVerified: z.boolean().optional(),
});
export type InsurerCreateInput = z.infer<typeof insurerCreateSchema>;
export const insurerUpdateSchema = insurerCreateSchema.partial();
export type InsurerUpdateInput = z.infer<typeof insurerUpdateSchema>;

/** Comparison table row. Internal notes are never public. */
export interface PublicInsurer {
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
  verifiedAt: string | null;
}

// ─── Phase 2: review invites and submission (TV-5) ───────────────────────────

export const reviewInviteCreateSchema = z.object({
  operatorId: z.string().uuid(),
  packageId: z.string().uuid().optional(),
  inquiryId: z.string().uuid().optional(),
  recipientName: z.string().trim().min(1),
  recipientContact: z.string().trim().min(3),
  tripDate: z.string().date(),
  expiresInDays: z.number().int().min(1).max(365).default(60),
  /** For an invite made from a Telegram inquiry: also send the link to the traveller in the bot. */
  sendTelegram: z.boolean().default(true),
});
export type ReviewInviteCreateInput = z.infer<typeof reviewInviteCreateSchema>;

export type ReviewInviteState = 'open' | 'used' | 'expired' | 'revoked';

/** Per-operator check on cherry-picking: how many invites went out and how many became reviews. */
export interface InviteStats {
  sent: number;
  used: number;
  open: number;
  expired: number;
  revoked: number;
  published: number;
  fromInquiries: number;
}

export interface PublicReviewInvite {
  state: ReviewInviteState;
  operatorName: string;
  operatorSlug: string;
  packageTitle: string | null;
  recipientName: string;
  tripDate: string;
}

export const reviewSubmitSchema = z.object({
  authorName: z.string().trim().min(1).max(60),
  rating: z.number().int().min(1).max(5),
  ratingGuide: z.number().int().min(1).max(5).optional(),
  ratingVehicle: z.number().int().min(1).max(5).optional(),
  ratingAccommodation: z.number().int().min(1).max(5).optional(),
  ratingValue: z.number().int().min(1).max(5).optional(),
  bodyRu: z.string().trim().min(30, 'Напишите хотя бы пару предложений о поездке').max(4000),
  consent: z.literal(true, { errorMap: () => ({ message: 'Нужно согласие на публикацию отзыва' }) }),
});
export type ReviewSubmitInput = z.infer<typeof reviewSubmitSchema>;
