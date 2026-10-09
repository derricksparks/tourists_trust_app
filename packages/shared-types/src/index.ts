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

/** Manual operator entry by staff (Phase 0); the same fields later back the intake form. */
export const operatorCreateSchema = z.object({
  name: z.string().trim().min(2),
  legalName: optionalText,
  countryCode,
  businessRegNumber: z.string().trim().min(1),
  tourismBoardLicense: z.string().trim().min(1),
  licensingAuthority: z.string().trim().min(1),
  address: z.string().trim().min(1),
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
});
export type OperatorCreateInput = z.infer<typeof operatorCreateSchema>;

export const operatorUpdateSchema = operatorCreateSchema.partial();
export type OperatorUpdateInput = z.infer<typeof operatorUpdateSchema>;

export const OPERATOR_DECISIONS = ['approve', 'reject', 'flag', 'suspend'] as const;
export type OperatorDecision = (typeof OPERATOR_DECISIONS)[number];

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
