import type { supabaseAdmin } from './supabase';

export type PayoutGateway = 'paystack' | 'monnify' | 'novac';

export const PAYOUT_GATEWAY_KEYS = [
  'active_payment_gateway',
  'gateway_paystack_enabled',
  'gateway_monnify_enabled',
  'gateway_novac_enabled',
] as const;

export type PayoutGatewayConfig = Readonly<Record<string, string | null | undefined>>;

const CONFIG_KEYS: ReadonlySet<string> = new Set(PAYOUT_GATEWAY_KEYS);

export function resolvePayoutGateway(config: PayoutGatewayConfig): PayoutGateway {
  const configured = config.active_payment_gateway;
  const active = (typeof configured === 'string' && configured !== '' ? configured : 'paystack').toLowerCase();
  if (active === 'monnify' && config.gateway_monnify_enabled === 'true') return 'monnify';
  if (active === 'novac' && config.gateway_novac_enabled === 'true') return 'novac';
  return 'paystack';
}

export function payoutGatewayConfig(rows: unknown): Record<string, string | null> {
  const config: Record<string, string | null> = {};
  if (!Array.isArray(rows)) return config;
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue;
    const { key, value } = row as { key?: unknown; value?: unknown };
    if (typeof key !== 'string' || !CONFIG_KEYS.has(key)) continue;
    config[key] = typeof value === 'string' ? value : null;
  }
  return config;
}

export async function readPayoutGateway(client: typeof supabaseAdmin): Promise<PayoutGateway | null> {
  try {
    const { data, error } = await client
      .from('app_config')
      .select('key, value')
      .in('key', [...PAYOUT_GATEWAY_KEYS]);
    if (error) {
      console.error('payout gateway lookup:', error.message);
      return null;
    }
    return resolvePayoutGateway(payoutGatewayConfig(data));
  } catch (error) {
    console.error('payout gateway lookup:', error instanceof Error ? error.message : String(error));
    return null;
  }
}
