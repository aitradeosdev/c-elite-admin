import type { NextConfig } from "next";

const securityHeaders = [
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), interest-cohort=()' },
];

const PLATFORM_SETTINGS_SECTIONS = ['platform-balance', 'limits-fees', 'bill-settings', 'anomaly-alerts', 'security-limits'];

const nextConfig: NextConfig = {
  async headers() {
    return [
      {
        source: '/:path*',
        headers: securityHeaders,
      },
    ];
  },
  async redirects() {
    return PLATFORM_SETTINGS_SECTIONS.map((section) => ({
      source: `/${section}`,
      destination: `/admin-settings/${section}`,
      permanent: false,
    }));
  },
};

export default nextConfig;
