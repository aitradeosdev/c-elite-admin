import type { NextConfig } from "next";

// Phase 35d: security headers.
// - X-Frame-Options: DENY prevents clickjacking (admin panel embedded in iframe).
// - Content-Security-Policy: mitigates XSS by refusing inline/eval scripts
//   except what Next.js itself requires. `style-src 'unsafe-inline'` stays
//   because Next.js inlines CSS; script-src omits 'unsafe-eval' to block
//   common XSS payloads but keeps 'unsafe-inline' + 'strict-dynamic' since
//   the app ships hydration scripts.
// - HSTS: force HTTPS for a year (only meaningful in production).
// - X-Content-Type-Options: nosniff stops browsers from MIME-sniffing file
//   downloads into executable content.
// - Referrer-Policy: strict-origin-when-cross-origin avoids leaking full URL
//   (which may contain admin IDs) to third-party domains.
// - Permissions-Policy: deny sensors the admin panel never needs.
const securityHeaders = [
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), interest-cohort=()' },
  {
    key: 'Content-Security-Policy',
    value: [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob: https:",
      "font-src 'self' data:",
      "connect-src 'self' https://*.supabase.co wss://*.supabase.co",
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "form-action 'self'",
    ].join('; '),
  },
];

const nextConfig: NextConfig = {
  async headers() {
    return [
      {
        source: '/:path*',
        headers: securityHeaders,
      },
    ];
  },
};

export default nextConfig;
