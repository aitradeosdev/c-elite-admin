'use client';

import { ConfigForm, validateIpv4List, type ConfigSection } from '../_config/ConfigForm';

const rejectsAll = (provider: string) => (next: string) => (
  next === '' ? `Every ${provider} webhook will be rejected (403) until an address is added.` : null
);

const SECTIONS: ConfigSection[] = [
  {
    title: 'Anti-Abuse Rate Limits',
    fields: [
      {
        key: 'signup_rate_limit_per_hour',
        label: 'Signups per IP / hour',
        hint: 'Max anonymous signups allowed from a single IP in a rolling 1-hour window.',
        input: 'number',
        min: 0,
        step: 1,
      },
    ],
  },
  {
    title: 'Webhook IP Allowlist',
    fields: [
      {
        key: 'paystack_webhook_ips',
        label: 'Paystack Webhook IPs (CSV)',
        hint: 'Comma-separated IPv4 addresses authorised to call the Paystack webhook. Update only when Paystack rotates their IPs.',
        input: 'textarea',
        mono: true,
        validate: validateIpv4List,
        consequence: rejectsAll('Paystack'),
      },
      {
        key: 'monnify_webhook_ips',
        label: 'Monnify Webhook IPs (CSV)',
        hint: "Comma-separated IPv4 addresses authorised to call the Monnify webhook (from Monnify's docs). If left empty, all Monnify webhooks are rejected (403).",
        input: 'textarea',
        mono: true,
        validate: validateIpv4List,
        consequence: rejectsAll('Monnify'),
      },
      {
        key: 'novac_webhook_ips',
        label: 'Novac Webhook IPs (CSV)',
        hint: "Comma-separated IPv4 addresses authorised to call the Novac webhook (from Novac's docs; they notify merchants before adding IPs). If left empty, all Novac webhooks are rejected (403).",
        input: 'textarea',
        mono: true,
        validate: validateIpv4List,
        consequence: rejectsAll('Novac'),
      },
    ],
  },
];

export default function SecurityLimitsPage() {
  return (
    <ConfigForm
      title="Rate Limits & Webhook IPs"
      subtitle="Control anti-abuse signup throttling and the IP allowlists that gate payment provider webhooks."
      endpoint="/api/security-limits"
      sections={SECTIONS}
    />
  );
}
