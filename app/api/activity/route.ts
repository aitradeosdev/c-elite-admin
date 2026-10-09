import type { NextRequest } from 'next/server';
import { supabaseAdmin } from '../../lib/supabase';
import { requireAdmin, type AdminContext, type Guarded } from '../../lib/guard';
import { writeAudit } from '../../lib/audit';
import { buildPagination, fail, isUuid, ok } from '../../lib/api';
import { sanitizeSearch } from '../../lib/sanitize';
import { businessDateKey, lagosDateToRangeEnd, lagosDateToRangeStart } from '../../lib/time';
import {
  ACTIVITY_GRANT, EXPORT_CAP, LEGACY_DEFAULT_LIMIT, LEGACY_MAX_LIMIT, MAX_PAGE_SIZE, PAGE_SIZE, SEARCH_MAX,
  SEARCH_USER_CAP, actionFilterKeys, actionsMatching, forScreen, isActionKey, isEntityKey, isResultFilter,
  presentEvent, resolveTarget, screenValue, targetRefs, targetSpec, toCsv, toPrintable,
  type ActivityEvent, type AdminInfo, type LookupRow, type ResultFilter, type StoredAuditRow, type TargetLookup,
  type TargetSpec,
} from '../../(dashboard)/activity/rules';

const EVENT_COLUMNS = [
  'id', 'admin_id', 'user_id', 'action', 'entity', 'entity_id', 'before_value', 'after_value', 'ip_address',
  'created_at', 'admin_role', 'user_agent', 'request_id', 'reason', 'result', 'error', 'sensitivity',
].join(', ');
const ADMIN_COLUMNS = 'id, username, role_title, is_super_admin, is_active, last_login_at, deleted_at';
const META_RESULT = 'after_value->__meta->>result';
const TEXT_SEARCH_COLUMNS = ['action', 'entity', 'entity_id', 'ip_address', 'request_id', 'reason', 'error'];

const EXPORT_BATCH = 1000;
const LOOKUP_BATCH = 100;
const LOOKUP_PARALLEL = 4;
const LOOKUP_ROUNDS = 4;
const RANGE_NOT_SATISFIABLE = 'PGRST103';

const DENIED = 'The activity log is open to super administrators and to admins granted Admin Activity.';
const ACCESS_UNCHECKED = 'Your access to the activity log could not be checked. Try again.';
const LOAD_FAILED = 'The activity log could not be loaded.';
const EVENT_FAILED = 'The activity event could not be loaded.';
const EVENT_MISSING = 'That activity event could not be found. It may be older than the audit log keeps.';
const SEARCH_FAILED = 'The search could not be run.';
const EXPORT_FAILED = 'The export could not be built.';
const EXPORT_UNRECORDED = 'The export was blocked because it could not be recorded in the audit log. Try again shortly.';
const TARGETS_PARTIAL = 'Some targets could not be looked up, so those rows show the record type only.';
const DATE_MESSAGE = 'Dates must be calendar days in YYYY-MM-DD format.';
const INSTANT_MESSAGE = 'before and after must be valid timestamps.';

type Parsed<T> = { ok: true; value: T } | { ok: false; message: string };

interface Filters {
  adminId: string | null;
  actions: string[] | null;
  entity: string | null;
  result: ResultFilter | null;
  fromIso: string | null;
  toIso: string | null;
  afterIso: string | null;
  beforeIso: string | null;
  search: string;
  ascending: boolean;
  through: string | null;
}

interface TargetLoad {
  lookup: TargetLookup;
  failed: boolean;
}

async function requireActivityAccess(): Promise<Guarded> {
  const guard = await requireAdmin();
  if (!guard.ok || guard.admin.is_super_admin) return guard;
  const { data, error } = await supabaseAdmin
    .from('admin_users')
    .select('page_permissions')
    .eq('id', guard.admin.admin_id)
    .maybeSingle();
  if (error) {
    console.error('activity access check:', error.message);
    return { ok: false, response: await fail('INTERNAL_ERROR', ACCESS_UNCHECKED) };
  }
  const grants = (data as { page_permissions?: unknown } | null)?.page_permissions;
  if (Array.isArray(grants) && grants.includes(ACTIVITY_GRANT)) return guard;
  return {
    ok: false,
    response: await fail('PERMISSION_DENIED', DENIED, { details: { required: [ACTIVITY_GRANT] } }),
  };
}

function trimmed(params: URLSearchParams, name: string): string {
  return (params.get(name) || '').trim();
}

function positiveInt(raw: string | null): number | null {
  const value = Math.floor(Number(raw));
  return Number.isFinite(value) && value >= 1 ? value : null;
}

function legacyLimit(raw: string | null): number {
  return Math.min(LEGACY_MAX_LIMIT, Math.max(1, Math.floor(Number(raw)) || LEGACY_DEFAULT_LIMIT));
}

function instantOf(raw: string | null): Parsed<string | null> {
  const value = (raw || '').trim();
  if (!value) return { ok: true, value: null };
  const time = Date.parse(value);
  return Number.isNaN(time) ? { ok: false, message: INSTANT_MESSAGE } : { ok: true, value: new Date(time).toISOString() };
}

function adminFilterOf(params: URLSearchParams): Parsed<string | null> {
  const raw = (params.get('admin_id') || params.get('admin_filter') || '').trim();
  if (!raw || raw === 'all') return { ok: true, value: null };
  return isUuid(raw) ? { ok: true, value: raw.toLowerCase() } : { ok: false, message: 'The admin filter must be an admin ID.' };
}

function resultOf(raw: string): Parsed<ResultFilter | null> {
  if (!raw) return { ok: true, value: null };
  return isResultFilter(raw) ? { ok: true, value: raw } : { ok: false, message: 'Unknown result filter.' };
}

function parseFilters(params: URLSearchParams): Parsed<Filters> {
  const admin = adminFilterOf(params);
  if (!admin.ok) return admin;
  const action = trimmed(params, 'action');
  if (action && !isActionKey(action)) return { ok: false, message: 'Unknown action filter.' };
  const entity = trimmed(params, 'entity');
  if (entity && !isEntityKey(entity)) return { ok: false, message: 'Unknown record type filter.' };
  const result = resultOf(trimmed(params, 'result'));
  if (!result.ok) return result;
  const dateFrom = trimmed(params, 'date_from');
  const dateTo = trimmed(params, 'date_to');
  const fromIso = dateFrom ? lagosDateToRangeStart(dateFrom) : null;
  const toIso = dateTo ? lagosDateToRangeEnd(dateTo) : null;
  if ((dateFrom && !fromIso) || (dateTo && !toIso)) return { ok: false, message: DATE_MESSAGE };
  const after = instantOf(params.get('after'));
  if (!after.ok) return after;
  const before = instantOf(params.get('before'));
  if (!before.ok) return before;
  return {
    ok: true,
    value: {
      adminId: admin.value,
      actions: action ? actionFilterKeys(action) : null,
      entity: entity || null,
      result: result.value,
      fromIso,
      toIso,
      afterIso: after.value,
      beforeIso: before.value,
      search: sanitizeSearch(params.get('search') || '', SEARCH_MAX),
      ascending: params.get('dir') === 'asc',
      through: null,
    },
  };
}

function filterEcho(params: URLSearchParams, filters: Filters) {
  return {
    admin_id: filters.adminId,
    action: filters.actions ? filters.actions[0] : null,
    entity: filters.entity,
    result: filters.result,
    date_from: trimmed(params, 'date_from') || null,
    date_to: trimmed(params, 'date_to') || null,
    after: filters.afterIso,
    before: filters.beforeIso,
    search: filters.search || null,
    dir: filters.ascending ? 'asc' : 'desc',
  };
}

async function loadAdmins(): Promise<AdminInfo[] | null> {
  const { data, error } = await supabaseAdmin
    .from('admin_users')
    .select(ADMIN_COLUMNS)
    .order('username', { ascending: true });
  if (error) {
    console.error('activity admins:', error.message);
    return null;
  }
  return (data ?? []) as unknown as AdminInfo[];
}

async function searchClauses(
  search: string,
  admins: readonly AdminInfo[],
): Promise<{ clauses: string[]; capped: boolean } | null> {
  const pattern = `%${search}%`;
  const clauses = TEXT_SEARCH_COLUMNS.map((column) => `${column}.ilike.${pattern}`);
  const labelled = actionsMatching(search);
  if (labelled.length > 0) clauses.push(`action.in.(${labelled.join(',')})`);
  if (isUuid(search)) {
    const id = search.toLowerCase();
    clauses.push(`id.eq.${id}`, `admin_id.eq.${id}`, `user_id.eq.${id}`);
  }
  const handle = search.replace(/^@+/, '').trim().toLowerCase();
  if (!handle) return { clauses, capped: false };

  const adminIds = admins
    .filter((admin) => (admin.username ?? '').toLowerCase().includes(handle))
    .map((admin) => admin.id)
    .filter((id) => isUuid(id));
  if (adminIds.length > 0) clauses.push(`admin_id.in.(${adminIds.join(',')})`);

  const like = `%${handle}%`;
  const { data, error } = await supabaseAdmin
    .from('users')
    .select('id')
    .or(`username.ilike.${like},full_name.ilike.${like},email.ilike.${like}`)
    .limit(SEARCH_USER_CAP + 1);
  if (error) {
    console.error('activity user search:', error.message);
    return null;
  }
  const ids = ((data ?? []) as { id: unknown }[])
    .map((row) => row.id)
    .filter((id): id is string => isUuid(id));
  const listed = ids.slice(0, SEARCH_USER_CAP);
  if (listed.length > 0) clauses.push(`user_id.in.(${listed.join(',')})`, `entity_id.in.(${listed.join(',')})`);
  return { clauses, capped: ids.length > SEARCH_USER_CAP };
}

function logicClause(filters: Filters, search: readonly string[]): string | null {
  const groups: string[] = [];
  if (filters.result && filters.result !== 'unrecorded') {
    groups.push(`or(result.eq.${filters.result},${META_RESULT}.eq.${filters.result})`);
  }
  if (search.length > 0) groups.push(`or(${search.join(',')})`);
  return groups.length > 0 ? `and(${groups.join(',')})` : null;
}

function scoped(columns: string, filters: Filters, clause: string | null, count?: 'exact', head = false) {
  let query = supabaseAdmin.from('audit_log').select(columns, { count, head }).not('admin_id', 'is', null);
  if (filters.adminId) query = query.eq('admin_id', filters.adminId);
  if (filters.actions && filters.actions.length === 1) query = query.eq('action', filters.actions[0]);
  else if (filters.actions) query = query.in('action', filters.actions);
  if (filters.entity) query = query.eq('entity', filters.entity);
  if (filters.result === 'unrecorded') query = query.is('result', null).is(META_RESULT, null);
  if (filters.fromIso) query = query.gte('created_at', filters.fromIso);
  if (filters.toIso) query = query.lt('created_at', filters.toIso);
  if (filters.afterIso) query = query.gte('created_at', filters.afterIso);
  if (filters.beforeIso) query = query.lt('created_at', filters.beforeIso);
  if (filters.through) query = query.lte('created_at', filters.through);
  if (clause) query = query.or(clause);
  return query;
}

async function fetchTargetRows(spec: TargetSpec, ids: readonly string[]): Promise<{ rows: LookupRow[]; failed: boolean }> {
  const chunks: string[][] = [];
  for (let i = 0; i < ids.length; i += LOOKUP_BATCH) chunks.push(ids.slice(i, i + LOOKUP_BATCH));
  const rows: LookupRow[] = [];
  let failed = false;
  for (let i = 0; i < chunks.length; i += LOOKUP_PARALLEL) {
    const results = await Promise.all(
      chunks
        .slice(i, i + LOOKUP_PARALLEL)
        .map((chunk) => supabaseAdmin.from(spec.table).select(spec.columns).in('id', chunk)),
    );
    for (const { data, error } of results) {
      if (error) {
        console.error('activity target lookup:', spec.table, error.message);
        failed = true;
        continue;
      }
      rows.push(...((data ?? []) as unknown as LookupRow[]));
    }
  }
  return { rows, failed };
}

async function loadTargets(rows: readonly StoredAuditRow[]): Promise<TargetLoad> {
  const store = new Map<string, Map<string, LookupRow>>();
  const requested = new Map<string, Set<string>>();
  let pending = new Map<string, Set<string>>();
  let failed = false;

  const want = (entity: string, raw: unknown) => {
    if (!targetSpec(entity) || !isUuid(raw)) return;
    const id = raw.toLowerCase();
    let asked = requested.get(entity);
    if (!asked) {
      asked = new Set();
      requested.set(entity, asked);
    }
    if (asked.has(id)) return;
    asked.add(id);
    let queued = pending.get(entity);
    if (!queued) {
      queued = new Set();
      pending.set(entity, queued);
    }
    queued.add(id);
  };

  for (const row of rows) {
    if (row.entity) want(row.entity, row.entity_id);
    want('users', row.user_id);
  }

  for (let round = 0; round < LOOKUP_ROUNDS && pending.size > 0; round += 1) {
    const batch = pending;
    pending = new Map();
    const results = await Promise.all(
      Array.from(batch, async ([entity, ids]) => {
        const spec = targetSpec(entity);
        const loaded = spec ? await fetchTargetRows(spec, Array.from(ids)) : { rows: [], failed: false };
        return { entity, ...loaded };
      }),
    );
    for (const result of results) {
      if (result.failed) failed = true;
      let bucket = store.get(result.entity);
      if (!bucket) {
        bucket = new Map();
        store.set(result.entity, bucket);
      }
      for (const row of result.rows) {
        const id = row.id;
        if (typeof id === 'string') bucket.set(id.toLowerCase(), row);
      }
    }
    for (const result of results) {
      for (const row of result.rows) {
        for (const ref of targetRefs(result.entity, row)) want(ref.entity, ref.id);
      }
    }
  }

  return {
    lookup: (entity, id) => (typeof id === 'string' ? store.get(entity)?.get(id.toLowerCase()) ?? null : null),
    failed,
  };
}

function presentRows(rows: readonly StoredAuditRow[], admins: readonly AdminInfo[], lookup: TargetLookup): ActivityEvent[] {
  const byId = new Map(admins.map((admin) => [admin.id.toLowerCase(), admin]));
  const adminOf = (id: string) => byId.get(id.toLowerCase());
  return rows.map((row) =>
    presentEvent(row, row.admin_id ? adminOf(row.admin_id) : undefined, resolveTarget(row, lookup, adminOf)));
}

async function readEvent(rawId: string) {
  const id = rawId.trim();
  if (!isUuid(id)) return fail('VALIDATION_ERROR', 'That activity event ID is not valid.');
  const [found, admins] = await Promise.all([
    supabaseAdmin
      .from('audit_log')
      .select(EVENT_COLUMNS)
      .eq('id', id.toLowerCase())
      .not('admin_id', 'is', null)
      .limit(1),
    loadAdmins(),
  ]);
  if (found.error) {
    console.error('activity event:', found.error.message);
    return fail('INTERNAL_ERROR', EVENT_FAILED);
  }
  if (!admins) return fail('INTERNAL_ERROR', EVENT_FAILED);
  const rows = (found.data ?? []) as unknown as StoredAuditRow[];
  if (rows.length === 0) return fail('RESOURCE_NOT_FOUND', EVENT_MISSING);
  const targets = await loadTargets(rows);
  const [event] = presentRows(rows, admins, targets.lookup);
  return ok({ event: forScreen(event), partial: { targets: targets.failed ? TARGETS_PARTIAL : null } });
}

async function prepareSearch(filters: Filters, admins: readonly AdminInfo[]) {
  if (!filters.search) return { clause: logicClause(filters, []), capped: false };
  const built = await searchClauses(filters.search, admins);
  if (!built) return null;
  return { clause: logicClause(filters, built.clauses), capped: built.capped };
}

async function listEvents(params: URLSearchParams) {
  const parsed = parseFilters(params);
  if (!parsed.ok) return fail('VALIDATION_ERROR', parsed.message);
  const filters = parsed.value;
  const admins = await loadAdmins();
  if (!admins) return fail('INTERNAL_ERROR', LOAD_FAILED);
  const prepared = await prepareSearch(filters, admins);
  if (!prepared) return fail('INTERNAL_ERROR', SEARCH_FAILED);

  const page = positiveInt(params.get('page')) ?? 1;
  const limit = Math.min(MAX_PAGE_SIZE, positiveInt(params.get('limit')) ?? PAGE_SIZE);
  const offset = (page - 1) * limit;

  const { data, error, count } = await scoped(EVENT_COLUMNS, filters, prepared.clause, 'exact')
    .order('created_at', { ascending: filters.ascending })
    .order('id', { ascending: filters.ascending })
    .range(offset, offset + limit - 1);

  let rows = (data ?? []) as unknown as StoredAuditRow[];
  let total = count ?? 0;
  if (error) {
    if (error.code !== RANGE_NOT_SATISFIABLE) {
      console.error('activity list:', error.message);
      return fail('INTERNAL_ERROR', LOAD_FAILED);
    }
    const recount = await scoped('id', filters, prepared.clause, 'exact', true);
    if (recount.error) {
      console.error('activity count:', recount.error.message);
      return fail('INTERNAL_ERROR', LOAD_FAILED);
    }
    rows = [];
    total = recount.count ?? 0;
  }

  const targets = await loadTargets(rows);
  return ok(
    {
      activity: presentRows(rows, admins, targets.lookup).map(forScreen),
      admins,
      total,
      page,
      limit,
      sort: 'created_at',
      dir: filters.ascending ? 'asc' : 'desc',
      search_capped: prepared.capped,
      partial: { targets: targets.failed ? TARGETS_PARTIAL : null },
    },
    { pagination: buildPagination(page, limit, total) },
  );
}

async function collectExport(filters: Filters, clause: string | null, cap: number) {
  const snapshot: Filters = { ...filters, through: new Date().toISOString() };
  const { count, error: countError } = await scoped('id', snapshot, clause, 'exact', true);
  if (countError) return { error: countError.message } as const;

  const total = count ?? 0;
  const target = Math.min(total, cap);
  const seen = new Set<string>();
  const rows: StoredAuditRow[] = [];
  let offset = 0;

  while (offset < target) {
    const end = Math.min(offset + EXPORT_BATCH, target) - 1;
    const { data, error } = await scoped(EVENT_COLUMNS, snapshot, clause)
      .order('created_at', { ascending: snapshot.ascending })
      .order('id', { ascending: snapshot.ascending })
      .range(offset, end);
    if (error) {
      if (error.code === RANGE_NOT_SATISFIABLE) break;
      return { error: error.message } as const;
    }
    const batch = (data ?? []) as unknown as StoredAuditRow[];
    if (batch.length === 0) break;
    for (const row of batch) {
      if (seen.has(row.id)) continue;
      seen.add(row.id);
      rows.push(row);
    }
    offset += batch.length;
  }

  return { rows, total, truncated: rows.length < total } as const;
}

async function exportEvents(admin: AdminContext, format: 'csv' | 'pdf', params: URLSearchParams) {
  const parsed = parseFilters(params);
  if (!parsed.ok) return fail('VALIDATION_ERROR', parsed.message);
  const filters = parsed.value;
  const admins = await loadAdmins();
  if (!admins) return fail('INTERNAL_ERROR', EXPORT_FAILED);
  const prepared = await prepareSearch(filters, admins);
  if (!prepared) return fail('INTERNAL_ERROR', SEARCH_FAILED);

  const cap = Math.min(EXPORT_CAP, positiveInt(params.get('limit')) ?? EXPORT_CAP);
  const collected = await collectExport(filters, prepared.clause, cap);
  if ('error' in collected) {
    console.error('activity export:', collected.error);
    return fail('INTERNAL_ERROR', EXPORT_FAILED);
  }

  const targets = await loadTargets(collected.rows);
  const events = presentRows(collected.rows, admins, targets.lookup);

  const audit = await writeAudit({
    admin,
    action: format === 'csv' ? 'EXPORT_CSV' : 'EXPORT_PDF',
    entity: 'audit_log',
    entity_id: null,
    after: {
      format,
      rows: events.length,
      total: collected.total,
      truncated: collected.truncated,
      search_capped: prepared.capped,
      filters: filterEcho(params, filters),
    },
    result: 'success',
    sensitivity: 'sensitive',
  });
  if (!audit.ok) return fail('AUDIT_FAILED', EXPORT_UNRECORDED);

  if (format === 'pdf') {
    return ok({
      rows: events.map(toPrintable),
      total: collected.total,
      truncated: collected.truncated,
      search_capped: prepared.capped,
      partial: { targets: targets.failed ? TARGETS_PARTIAL : null },
    });
  }

  return new Response(toCsv(events), {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="admin-activity-${businessDateKey(new Date())}.csv"`,
      'Cache-Control': 'no-store',
      'X-Total-Count': String(collected.total),
      'X-Export-Rows': String(events.length),
      'X-Export-Truncated': collected.truncated ? '1' : '0',
      'x-request-id': admin.request_id,
    },
  });
}

async function legacyList(admin: AdminContext, params: URLSearchParams) {
  const adminFilter = adminFilterOf(params);
  if (!adminFilter.ok) return fail('VALIDATION_ERROR', adminFilter.message);
  const before = instantOf(params.get('before'));
  if (!before.ok) return fail('VALIDATION_ERROR', before.message);
  const after = instantOf(params.get('after'));
  if (!after.ok) return fail('VALIDATION_ERROR', after.message);

  const [listed, admins] = await Promise.all([
    supabaseAdmin.rpc('list_admin_activity', {
      p_caller_admin_id: admin.admin_id,
      p_limit: legacyLimit(params.get('limit')),
      p_before: before.value,
      p_admin_filter: adminFilter.value,
      p_after: after.value,
    }),
    loadAdmins(),
  ]);
  if (listed.error) {
    if (/forbidden/i.test(listed.error.message || '')) return fail('PERMISSION_DENIED', DENIED);
    console.error('list_admin_activity:', listed.error.message);
    return fail('INTERNAL_ERROR', LOAD_FAILED);
  }
  if (!admins) return fail('INTERNAL_ERROR', LOAD_FAILED);

  const activity = ((listed.data ?? []) as Record<string, unknown>[]).map((row) => ({
    ...row,
    before_value: screenValue(row.before_value),
    after_value: screenValue(row.after_value),
  }));
  return ok({ activity, admins });
}

export async function GET(req: NextRequest) {
  const guard = await requireActivityAccess();
  if (!guard.ok) return guard.response;
  const { admin } = guard;
  const params = new URL(req.url).searchParams;

  const id = params.get('id');
  if (id !== null) return readEvent(id);

  const exportFormat = trimmed(params, 'export').toLowerCase();
  if (exportFormat === 'csv' || exportFormat === 'pdf') return exportEvents(admin, exportFormat, params);
  if (exportFormat) return fail('VALIDATION_ERROR', 'Exports are available as csv or pdf.');
  if (trimmed(params, 'format').toLowerCase() === 'csv') return exportEvents(admin, 'csv', params);
  if (params.has('page')) return listEvents(params);
  return legacyList(admin, params);
}
