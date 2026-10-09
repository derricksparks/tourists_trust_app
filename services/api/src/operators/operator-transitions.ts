import { OperatorStatus } from '@prisma/client';
import { OperatorDecision } from '@ttp/shared-types';

/**
 * The operator approval workflow (spec TV-2). Each decision moves an operator into one
 * status and is only allowed from the listed statuses:
 *
 *   PENDING ──approve──▶ APPROVED ──suspend──▶ SUSPENDED ──approve──▶ APPROVED
 *      │  ╲──flag──▶ FLAGGED ──approve / reject
 *      ╰──reject──▶ REJECTED (final; a rejected operator re-applies as a new record)
 */
export const OPERATOR_TRANSITIONS: Record<OperatorDecision, { from: OperatorStatus[]; to: OperatorStatus }> = {
  approve: { from: ['PENDING', 'FLAGGED', 'SUSPENDED'], to: 'APPROVED' },
  reject: { from: ['PENDING', 'FLAGGED'], to: 'REJECTED' },
  flag: { from: ['PENDING'], to: 'FLAGGED' },
  suspend: { from: ['APPROVED'], to: 'SUSPENDED' },
};
