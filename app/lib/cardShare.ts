export const SHARE_CHANNELS = ['whatsapp', 'telegram', 'email', 'copy', 'native', 'download'] as const;

export type ShareChannel = (typeof SHARE_CHANNELS)[number];

export function isShareChannel(value: unknown): value is ShareChannel {
  return typeof value === 'string' && (SHARE_CHANNELS as readonly string[]).includes(value);
}

export interface ShareableSubmission {
  cardName: string | null;
  countryName: string | null;
  countryCode: string | null;
  amountForeign: number | string | null;
  submittedFields: Record<string, unknown> | null;
  fieldLabels: Record<string, string>;
}

export function buildCardShareText(s: ShareableSubmission): string {
  const lines: string[] = [];
  if (s.cardName) lines.push(`Card: ${s.cardName}`);
  const country = s.countryName || s.countryCode;
  if (country) lines.push(`Country: ${country}`);
  if (s.amountForeign) lines.push(`Value: ${s.amountForeign}`);
  if (s.submittedFields) {
    for (const [key, value] of Object.entries(s.submittedFields)) {
      if (value && typeof value === 'string') lines.push(`${s.fieldLabels[key] || key}: ${value}`);
    }
  }
  return lines.join('\n');
}

export function shareSubject(cardName: string | null): string {
  return `Card Submission - ${cardName || ''}`;
}

export function sharedFieldLabels(s: ShareableSubmission): string[] {
  if (!s.submittedFields) return [];
  return Object.entries(s.submittedFields)
    .filter(([, value]) => value && typeof value === 'string')
    .map(([key]) => s.fieldLabels[key] || key);
}

export function permissionForChannel(channel: ShareChannel): 'sensitive_data.download' | 'sensitive_data.share' {
  return channel === 'download' ? 'sensitive_data.download' : 'sensitive_data.share';
}
