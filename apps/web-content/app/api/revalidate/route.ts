import { revalidateTag } from 'next/cache';
import { NextResponse } from 'next/server';

const TAGS = new Set(['operators', 'guides', 'translators']);

/** Called by the API after an approval, suspension, review or guide change. */
export async function POST(req: Request) {
  const secret = process.env.REVALIDATE_SECRET;
  if (!secret || req.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
  }
  const body = (await req.json().catch(() => ({}))) as { tags?: unknown };
  const tags = Array.isArray(body.tags) ? body.tags.filter((t): t is string => typeof t === 'string' && TAGS.has(t)) : [];
  tags.forEach((t) => revalidateTag(t));
  return NextResponse.json({ revalidated: tags });
}
