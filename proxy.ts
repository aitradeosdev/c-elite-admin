import { NextResponse, NextRequest } from 'next/server';

function buildCsp(nonce: string, isDev: boolean): string {
  const parts = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isDev ? " 'unsafe-eval'" : ''}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https:",
    "font-src 'self' data:",
    "connect-src 'self' https://*.supabase.co wss://*.supabase.co",
    "frame-src 'self'",
    "object-src 'none'",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    'upgrade-insecure-requests',
  ];
  return parts.join('; ');
}

function rejectCrossOrigin(req: NextRequest): NextResponse | null {
  const method = req.method.toUpperCase();
  if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') return null;
  if (!req.nextUrl.pathname.startsWith('/api/')) return null;

  const auth = req.headers.get('authorization');
  if (auth && /^Bearer\s+/i.test(auth) && req.headers.get('x-client') === 'mobile-admin') {
    return null;
  }

  const sfs = req.headers.get('sec-fetch-site');
  if (sfs === 'same-origin' || sfs === 'none') return null;

  const origin = req.headers.get('origin');
  if (origin) {
    try {
      const o = new URL(origin);
      const u = new URL(req.url);
      if (o.host === u.host && o.protocol === u.protocol) return null;
    } catch {}
  }

  return new NextResponse(JSON.stringify({ error: 'Origin not allowed' }), {
    status: 403,
    headers: { 'Content-Type': 'application/json' },
  });
}

export function proxy(req: NextRequest) {
  const blocked = rejectCrossOrigin(req);
  if (blocked) return blocked;

  const nonce = Buffer.from(crypto.randomUUID()).toString('base64');
  const isDev = process.env.NODE_ENV === 'development';
  const csp = buildCsp(nonce, isDev);

  const requestHeaders = new Headers(req.headers);
  requestHeaders.set('x-nonce', nonce);
  requestHeaders.set('Content-Security-Policy', csp);

  const res = NextResponse.next({ request: { headers: requestHeaders } });
  res.headers.set('Content-Security-Policy', csp);
  return res;
}

export const config = {
  matcher: [
    {
      source: '/((?!_next/static|_next/image|favicon.ico).*)',
      missing: [
        { type: 'header', key: 'next-router-prefetch' },
        { type: 'header', key: 'purpose', value: 'prefetch' },
      ],
    },
  ],
};
