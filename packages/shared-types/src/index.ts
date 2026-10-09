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
