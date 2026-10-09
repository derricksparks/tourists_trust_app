/** Country names; staff add countries (Phase 4), so useCountries() fills this from the API. */
const COUNTRY_NAMES: Record<string, string> = { UG: 'Uganda', TZ: 'Tanzania', KE: 'Kenya', RW: 'Rwanda', RU: 'Russia' };
export const countryName = (code: string) => COUNTRY_NAMES[code] ?? code;
export function registerCountries(list: { code: string; nameEn: string }[]) {
  for (const c of list) COUNTRY_NAMES[c.code] = c.nameEn;
}

export const formatDate = (iso: string) =>
  new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });

export const formatDateTime = (iso: string) =>
  new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });

export const titleCase = (s: string) => s.charAt(0) + s.slice(1).toLowerCase();

/** Audit-log action → what a person reads in the history list. */
export const ACTION_LABELS: Record<string, string> = {
  'operator.create': 'Added',
  'operator.update': 'Edited',
  'operator.approve': 'Approved',
  'operator.reject': 'Rejected',
  'operator.flag': 'Flagged',
  'operator.suspend': 'Suspended',
  'operator.signup': 'Signed up on the portal',
  'operator.application_update': 'Application edited by the operator',
  'operator.submit': 'Application sent for review',
  'operator.document_upload': 'Document uploaded',
  'operator.document_view': 'Document opened',
  'operator.document_review': 'Document checked',
};
