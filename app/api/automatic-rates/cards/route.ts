import type { NextRequest } from 'next/server';
import { requireAdmin, type AdminContext } from '../../../lib/guard';
import { fail, ok } from '../../../lib/api';
import { loadRateTree } from '../../../lib/rateTree';
import { callRateSync, readRateSync, writeDenied } from '../../../lib/rateSync';
import {
  PERCENT_MESSAGE, TEXT, isCount, isNotAuthorized, rateOutOfRangeText, readLinksBody, readMarkupBody, readPct,
} from '../../../(dashboard)/automatic-rates/rules';

type Body = Record<string, unknown>;

function isRecord(value: unknown): value is Body {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function audited(admin: AdminContext) {
  return { p_admin_id: admin.admin_id, p_ip: admin.ip, p_user_agent: admin.user_agent, p_request_id: admin.request_id };
}

function invalidLink(answer: Body) {
  const first = Array.isArray(answer.invalid) && isRecord(answer.invalid[0]) ? answer.invalid[0] : null;
  const reason = typeof first?.reason === 'string' ? first.reason : null;
  const details = { reason, invalid: answer.invalid };
  switch (reason) {
    case 'unknown_product':
      return fail('STATE_CONFLICT', TEXT.linksUnknownProduct, { details });
    case 'type_inactive':
      return fail('STATE_CONFLICT', TEXT.linksTypeInactive, { details });
    case 'type_not_found':
      return fail('RESOURCE_NOT_FOUND', TEXT.linksTypeMissing, { details });
    case 'no_currency_symbol':
      return fail('STATE_CONFLICT', TEXT.linksNoSymbol, { details });
  }
  const position = typeof first?.index === 'number' && Number.isInteger(first.index) ? first.index + 1 : null;
  return fail('VALIDATION_ERROR', position === null ? TEXT.linksInvalid : `Link ${position} is not valid.`, { details });
}

async function saveLinks(admin: AdminContext, body: Body) {
  const checked = readLinksBody(body);
  if (!checked.ok) return fail('VALIDATION_ERROR', checked.message);

  const result = await callRateSync('admin_save_rate_links', { ...audited(admin), p_changes: checked.value });
  if (!result.ok) {
    if (isNotAuthorized(result.message)) return writeDenied();
    console.error('admin_save_rate_links:', result.message);
    return fail('INTERNAL_ERROR', TEXT.linksNotSaved, { details: { outcome_unknown: true } });
  }

  const answer = isRecord(result.data) ? result.data : null;
  if (answer?.ok === true && Array.isArray(answer.saved) && Array.isArray(answer.unchanged)) {
    return ok({ saved: answer.saved, unchanged: answer.unchanged });
  }
  switch (answer?.reason) {
    case 'no_changes':
      return fail('VALIDATION_ERROR', TEXT.linksNoChanges);
    case 'too_many':
      return fail('VALIDATION_ERROR', TEXT.linksTooMany);
    case 'no_provider':
      return fail('STATE_CONFLICT', TEXT.linksNoProvider, { details: { reason: 'no_provider' } });
    case 'invalid':
      return invalidLink(answer);
    case 'conflict':
      return fail('STATE_CONFLICT', TEXT.linksConflict, {
        details: { reason: 'conflict', conflicts: answer.conflicts },
      });
  }
  console.error('admin_save_rate_links: the answer did not have the expected shape');
  return fail('INTERNAL_ERROR', TEXT.linksNotSaved, { details: { outcome_unknown: true } });
}

async function saveMarkup(admin: AdminContext, body: Body) {
  const checked = readMarkupBody(body);
  if (!checked.ok) return fail('VALIDATION_ERROR', checked.message);
  const { cardId, pct, expected } = checked.value;

  const result = await callRateSync('admin_set_card_rate_markup', {
    ...audited(admin),
    p_card_id: cardId,
    p_markup_pct: pct,
    p_expected: expected,
  });
  if (!result.ok) {
    if (isNotAuthorized(result.message)) return writeDenied();
    console.error('admin_set_card_rate_markup:', result.message);
    return fail('INTERNAL_ERROR', TEXT.markupNotSaved, { details: { outcome_unknown: true } });
  }

  const answer = isRecord(result.data) ? result.data : null;
  if (answer?.ok === true) {
    const own = answer.card_markup_pct === null ? null : readPct(answer.card_markup_pct);
    const effective = readPct(answer.effective_markup_pct);
    if (typeof answer.changed !== 'boolean' || effective === null || !isCount(answer.repriced)
      || (answer.card_markup_pct !== null && own === null)) {
      console.error('admin_set_card_rate_markup: the answer did not have the expected shape');
      return fail('INTERNAL_ERROR', TEXT.markupNotSaved, { details: { outcome_unknown: true } });
    }
    return ok({ changed: answer.changed, card_markup_pct: own, effective_markup_pct: effective, repriced: answer.repriced });
  }
  switch (answer?.reason) {
    case 'invalid_percentage':
      return fail('VALIDATION_ERROR', PERCENT_MESSAGE);
    case 'conflict':
      return fail('STATE_CONFLICT', TEXT.markupConflict, {
        details: { reason: 'conflict', current: answer.current, effective: answer.effective },
      });
    case 'card_not_found':
      return fail('RESOURCE_NOT_FOUND', TEXT.markupCardMissing);
    case 'rate_out_of_range':
      return fail('STATE_CONFLICT', rateOutOfRangeText(answer), {
        details: { reason: 'rate_out_of_range', range_label: answer.range_label, card_type_id: answer.card_type_id },
      });
  }
  console.error('admin_set_card_rate_markup: the answer did not have the expected shape');
  return fail('INTERNAL_ERROR', TEXT.markupNotSaved, { details: { outcome_unknown: true } });
}

export async function GET() {
  const guard = await requireAdmin('rates.read');
  if (!guard.ok) return guard.response;

  const cards = await loadRateTree();
  if (!cards) return fail('INTERNAL_ERROR', TEXT.cardsFailed);
  const overview = await readRateSync('rate_sync_overview');
  if (!overview) return fail('INTERNAL_ERROR', TEXT.cardsFailed);
  return ok({ cards, automatic: overview });
}

export async function PATCH(req: NextRequest) {
  const guard = await requireAdmin('rates.write');
  if (!guard.ok) return guard.response;

  const body: unknown = await req.json().catch(() => null);
  if (!isRecord(body)) return fail('VALIDATION_ERROR', 'Send the changes as a JSON object.');
  if (body.type === 'links') return saveLinks(guard.admin, body);
  if (body.type === 'markup') return saveMarkup(guard.admin, body);
  return fail('VALIDATION_ERROR', TEXT.cardsBody);
}
