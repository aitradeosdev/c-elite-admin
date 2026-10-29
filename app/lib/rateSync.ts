import { supabaseAdmin } from './supabase';
import { ERROR_MESSAGE, fail } from './api';
import type { Refusal } from '../(dashboard)/automatic-rates/rules';

export type SyncRead = 'rate_sync_status' | 'rate_sync_overview';

export type RpcAnswer = { ok: true; data: unknown } | { ok: false; message: string };

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export async function callRateSync(name: string, args: Record<string, unknown>): Promise<RpcAnswer> {
  try {
    const { data, error } = await supabaseAdmin.rpc(name, args);
    if (error) return { ok: false, message: error.message };
    return { ok: true, data };
  } catch (error) {
    return { ok: false, message: describe(error) };
  }
}

export async function readRateSync(name: SyncRead): Promise<Record<string, unknown> | null> {
  try {
    const { data, error } = await supabaseAdmin.rpc(name);
    if (error) {
      console.error(`${name}:`, error.message);
      return null;
    }
    if (!isRecord(data)) {
      console.error(`${name}: the answer was not an object`);
      return null;
    }
    return data;
  } catch (error) {
    console.error(`${name}:`, describe(error));
    return null;
  }
}

export function ratesAutomatic(status: Readonly<Record<string, unknown>>): Record<string, unknown> {
  return {
    enabled: status.enabled,
    interval_minutes: status.interval_minutes,
    next_due_at: status.next_due_at,
    stale: status.stale,
    failures: status.failures,
    linked_card_type_ids: status.linked_card_type_ids,
  };
}

export function refuse(refusal: Refusal) {
  return fail(refusal.code, refusal.message, refusal.details ? { details: refusal.details } : undefined);
}

export function writeDenied() {
  return fail('PERMISSION_DENIED', ERROR_MESSAGE.PERMISSION_DENIED, { details: { required: ['rates.write'] } });
}
