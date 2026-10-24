export type EdgeAnswer =
  | { kind: 'answered'; status: number; body: unknown }
  | { kind: 'failed'; error: unknown };

const MISSING_SETTINGS = 'SUPABASE_URL or ADMIN_FUNCTION_SECRET is not set';

function edgeUrl(slug: string): string | null {
  const base = (process.env.SUPABASE_URL || '').replace(/\/+$/, '');
  return base ? `${base}/functions/v1/${slug}` : null;
}

function parseJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export async function callEdgeFunction(
  slug: string,
  payload: Record<string, unknown>,
  timeoutMs: number,
  bearer?: string,
): Promise<EdgeAnswer> {
  const url = edgeUrl(slug);
  const secret = process.env.ADMIN_FUNCTION_SECRET || '';
  if (!url || !secret) return { kind: 'failed', error: new Error(MISSING_SETTINGS) };
  let response: Response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-admin-secret': secret,
        ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}),
      },
      body: JSON.stringify(payload),
      cache: 'no-store',
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    return { kind: 'failed', error };
  }
  let raw: string;
  try {
    raw = await response.text();
  } catch (error) {
    return { kind: 'failed', error };
  }
  return { kind: 'answered', status: response.status, body: parseJson(raw) };
}
