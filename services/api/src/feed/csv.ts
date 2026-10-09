import { FeedPackageInput, externalRefSchema, feedPackageSchema } from '@ttp/shared-types';

/**
 * Spreadsheet import of tours (B2B-1 "spreadsheet import"). One row per tour, matched to existing
 * tours by external_ref. Lists inside a cell are separated by "|", so the file can use either
 * commas or semicolons between columns (Excel picks one depending on the computer's language).
 */
export const CSV_COLUMNS = [
  'external_ref', 'title', 'title_ru', 'description_ru', 'description_en', 'country', 'duration_days',
  'price', 'currency', 'price_basis', 'capacity', 'inclusions', 'exclusions', 'dates', 'published',
] as const;
type Column = (typeof CSV_COLUMNS)[number];

/** RFC 4180 parsing: quoted fields may hold the delimiter, quotes ("") and line breaks. */
export function parseCsv(text: string): string[][] {
  const src = text.replace(/^﻿/, '');
  const firstLine = src.split(/\r?\n/, 1)[0] ?? '';
  const delimiter = firstLine.includes(';') && !firstLine.includes(',') ? ';' : ',';
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quoted) {
      if (c === '"' && src[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"' && field === '') quoted = true;
    else if (c === delimiter) {
      row.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && src[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else field += c;
  }
  if (field !== '' || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((f) => f.trim() !== ''));
}

const list = (v: string) => v.split('|').map((s) => s.trim()).filter(Boolean);
const num = (v: string) => (v.trim() === '' ? null : Number(v.trim().replace(/\s/g, '').replace(',', '.')));

export interface ParsedRow {
  row: number;
  externalRef: string | null;
  input: FeedPackageInput | null;
  errors: string[];
}

/** Turns the sheet into validated tour inputs, with errors in the operator's terms (column names). */
export function rowsFromCsv(text: string): { rows: ParsedRow[]; error?: string } {
  const [header, ...body] = parseCsv(text);
  if (!header) return { rows: [], error: 'The file is empty' };
  const cols = header.map((h) => h.trim().toLowerCase());
  const missing = ['external_ref', 'title', 'country', 'duration_days'].filter((c) => !cols.includes(c));
  if (missing.length) return { rows: [], error: `Missing columns: ${missing.join(', ')}. Download the template to see the expected header.` };
  const unknown = cols.filter((c) => c && !(CSV_COLUMNS as readonly string[]).includes(c));
  if (unknown.length) return { rows: [], error: `Unknown columns: ${unknown.join(', ')}` };
  if (body.length > 500) return { rows: [], error: 'At most 500 tours per file' };

  const seen = new Set<string>();
  const rows = body.map((cells, i): ParsedRow => {
    const get = (c: Column) => (cells[cols.indexOf(c)] ?? '').trim();
    const errors: string[] = [];
    const ref = get('external_ref');
    if (!externalRefSchema.safeParse(ref).success) errors.push('external_ref: letters, digits and . _ : - only (your own id for the tour)');
    else if (seen.has(ref)) errors.push(`external_ref "${ref}" appears twice in the file`);
    seen.add(ref);

    const dates = list(get('dates')).map((d) => {
      const [startDate, endDate] = d.split('/').map((x) => x.trim());
      return { startDate, endDate: endDate ?? startDate };
    });
    const published = get('published').toLowerCase();
    const candidate = {
      title: get('title'),
      titleRu: get('title_ru') || null,
      descriptionRu: get('description_ru') || null,
      descriptionEn: get('description_en') || null,
      countryCode: get('country').toUpperCase(),
      durationDays: num(get('duration_days')),
      price: num(get('price')),
      currency: get('currency').toUpperCase() || null,
      priceBasis: get('price_basis').toLowerCase() === 'per_group' ? 'PER_GROUP' : 'PER_PERSON',
      capacity: num(get('capacity')),
      inclusions: list(get('inclusions')),
      exclusions: list(get('exclusions')),
      dates,
      published: ['yes', 'y', 'true', '1', 'да'].includes(published),
    };
    const parsed = feedPackageSchema.safeParse(candidate);
    if (!parsed.success) {
      for (const issue of parsed.error.issues) errors.push(`${columnFor(String(issue.path[0]))}: ${issue.message}`);
    }
    return { row: i + 2, externalRef: ref || null, input: parsed.success && !errors.length ? parsed.data : null, errors };
  });
  return { rows };
}

const COLUMN_FOR: Record<string, string> = {
  title: 'title', titleRu: 'title_ru', descriptionRu: 'description_ru', descriptionEn: 'description_en', countryCode: 'country',
  durationDays: 'duration_days', price: 'price', currency: 'currency', capacity: 'capacity', inclusions: 'inclusions',
  exclusions: 'exclusions', dates: 'dates (YYYY-MM-DD/YYYY-MM-DD | …)',
};
const columnFor = (field: string) => COLUMN_FOR[field] ?? field;
