import { supabaseAdmin } from './supabase';
import {
  assembleRateTree,
  type CardRow, type CountryRow, type RateTreeCard, type StoredDenomination, type TypeRow,
} from '../(dashboard)/rates/rateRules';

const PAGE_ROWS = 1000;
const MAX_PAGES = 100;

export const DENOMINATION_COLUMNS = 'id, card_type_id, range_label, min_value, max_value, rate_naira, is_active';

interface PageResponse {
  data: unknown[] | null;
  error: { message: string } | null;
  count?: number | null;
}

async function readAll<T>(
  label: string,
  page: (from: number, to: number) => PromiseLike<PageResponse>,
): Promise<T[] | null> {
  const rows: T[] = [];
  let total: number | null = null;
  for (let index = 0; index < MAX_PAGES; index += 1) {
    const from = index * PAGE_ROWS;
    const { data, error, count } = await page(from, from + PAGE_ROWS - 1);
    if (error) {
      console.error(`rates ${label} read:`, error.message);
      return null;
    }
    const batch = (data ?? []) as T[];
    if (total === null && typeof count === 'number') total = count;
    rows.push(...batch);
    const finished = total !== null ? rows.length >= total : batch.length < PAGE_ROWS;
    if (batch.length === 0 || finished) return rows;
  }
  console.error(`rates ${label} read: more than ${MAX_PAGES * PAGE_ROWS} rows`);
  return null;
}

export async function loadRateTree(): Promise<RateTreeCard[] | null> {
  const [cards, countries, types, denominations] = await Promise.all([
    readAll<CardRow>('cards', (from, to) => supabaseAdmin
      .from('cards')
      .select('id, name, logo_url, is_active, sort_order', { count: 'exact' })
      .eq('is_active', true)
      .order('id', { ascending: true })
      .range(from, to)),
    readAll<CountryRow>('countries', (from, to) => supabaseAdmin
      .from('card_countries')
      .select('id, card_id, country_code, country_name, currency_symbol', { count: 'exact' })
      .eq('is_active', true)
      .order('id', { ascending: true })
      .range(from, to)),
    readAll<TypeRow>('types', (from, to) => supabaseAdmin
      .from('card_types')
      .select('id, card_id, country_code, name, sort_order', { count: 'exact' })
      .eq('is_active', true)
      .order('id', { ascending: true })
      .range(from, to)),
    readAll<StoredDenomination>('denominations', (from, to) => supabaseAdmin
      .from('denominations')
      .select(DENOMINATION_COLUMNS, { count: 'exact' })
      .order('id', { ascending: true })
      .range(from, to)),
  ]);

  if (!cards || !countries || !types || !denominations) return null;
  return assembleRateTree(cards, countries, types, denominations);
}
