import { before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createElement, type ElementType, type ReactElement } from 'react';
import { loadAppModule, render, tagsOf, textOf } from './support/uiHarness.ts';
import type { ApiFailure, ApiResult } from '../app/lib/apiClient.ts';
import type { TemplateRecord } from '../app/(dashboard)/notification-templates/templateRules.ts';
import type { SaveReceipt } from '../app/(dashboard)/notification-templates/templateModel.ts';

type Rules = typeof import('../app/(dashboard)/notification-templates/templateRules.ts');
type Diff = typeof import('../app/(dashboard)/notification-templates/textDiff.ts');
type Model = typeof import('../app/(dashboard)/notification-templates/templateModel.ts');
type Dialogs = typeof import('../app/(dashboard)/notification-templates/confirmOptions.tsx');
type Email = typeof import('../app/(dashboard)/email-templates/previewDocument.ts');

let rules: Rules;
let diff: Diff;
let model: Model;
let dialogs: Dialogs;
let email: Email;
let parts: Record<string, ElementType>;
let emailParts: Record<string, ElementType>;

before(async () => {
  rules = await loadAppModule<Rules>('(dashboard)/notification-templates/templateRules.ts');
  diff = await loadAppModule<Diff>('(dashboard)/notification-templates/textDiff.ts');
  model = await loadAppModule<Model>('(dashboard)/notification-templates/templateModel.ts');
  dialogs = await loadAppModule<Dialogs>('(dashboard)/notification-templates/confirmOptions.tsx');
  email = await loadAppModule<Email>('(dashboard)/email-templates/previewDocument.ts');
  parts = await loadAppModule<Record<string, ElementType>>('(dashboard)/notification-templates/TemplateParts.tsx');
  emailParts = await loadAppModule<Record<string, ElementType>>('(dashboard)/email-templates/EmailPreview.tsx');
});

const NOTIFICATION_DIR = fileURLToPath(new URL('../app/(dashboard)/notification-templates/', import.meta.url));
const EMAIL_DIR = fileURLToPath(new URL('../app/(dashboard)/email-templates/', import.meta.url));
const NOTIFICATION_ROUTE = fileURLToPath(new URL('../app/api/notification-templates/route.ts', import.meta.url));
const EMAIL_ROUTE = fileURLToPath(new URL('../app/api/email-templates/route.ts', import.meta.url));
const SCHEMA_FILE = fileURLToPath(new URL('../../schema.sql', import.meta.url));

const CARD_VARIABLES = ['symbol', 'amount_foreign', 'card_name', 'type_parens', 'credit'];
const CARD_BODY = '{symbol}{amount_foreign} {card_name}{type_parens} approved — ₦{credit} credited to your wallet';
const STAMP = '2026-10-01T09:00:00.123+00:00';

const CARD_ROW = {
  key: 'card_approved',
  title: 'Card Approved',
  body: CARD_BODY,
  description: 'Fires when admin approves a card submission.',
  variables: CARD_VARIABLES,
  is_active: true,
  updated_at: STAMP,
};

const DEVICE_ROW = {
  key: 'new_device_login',
  subject: 'New device signed into CardElite',
  html: '<div><p>Hi {first_name}, a new device signed in.</p><div><b>IP:</b> {ip}</div></div>',
  description: 'Fires when a user signs in from a never-seen device fingerprint.',
  variables: ['first_name', 'device_model', 'os_version', 'app_version', 'ip', 'when'],
  is_active: true,
  updated_at: STAMP,
};

function cardRecord(overrides: Partial<typeof CARD_ROW> = {}): TemplateRecord {
  const record = rules.toTemplateRecord(rules.NOTIFICATION_CHANNEL, { ...CARD_ROW, ...overrides });
  assert.ok(record);
  return record;
}

function deviceRecord(overrides: Partial<typeof DEVICE_ROW> = {}): TemplateRecord {
  const record = rules.toTemplateRecord(rules.EMAIL_CHANNEL, { ...DEVICE_ROW, ...overrides });
  assert.ok(record);
  return record;
}

function failure(patch: Partial<ApiFailure>): ApiResult<SaveReceipt> {
  return {
    ok: false,
    error: {
      kind: 'http', status: 400, code: 'VALIDATION_ERROR', message: 'Nope', requestId: null, details: null,
      outcomeUnknown: false, ...patch,
    },
  };
}

describe('placeholder scanning', () => {
  test('known variables become filled segments and are counted', () => {
    const scan = rules.scanTemplate(CARD_BODY, CARD_VARIABLES, 'text');
    assert.deepEqual(scan.issues, []);
    assert.deepEqual(scan.uses, { symbol: 1, amount_foreign: 1, card_name: 1, type_parens: 1, credit: 1 });
    assert.equal(scan.segments.filter((segment) => segment.kind === 'variable').length, 5);
  });

  test('an unknown variable is flagged with the closest supported name', () => {
    const scan = rules.scanTemplate('₦{Credit} credited', CARD_VARIABLES, 'text');
    assert.equal(scan.issues.length, 1);
    assert.equal(scan.issues[0].kind, 'unknown');
    assert.equal(scan.issues[0].token, '{Credit}');
    assert.match(rules.describeIssue(scan.issues[0], CARD_VARIABLES), /Did you mean \{credit\}\?/);
  });

  test('an unknown variable with no near match lists what the template supports', () => {
    const scan = rules.scanTemplate('{balance}', ['amount'], 'text');
    assert.match(rules.describeIssue(scan.issues[0], ['amount']), /Use one of \{amount\}/);
    const none = rules.scanTemplate('{balance}', [], 'text');
    assert.match(rules.describeIssue(none.issues[0], []), /no variables/);
  });

  test('spaced, doubled, unclosed and unopened placeholders are flagged in plain text', () => {
    const kinds = (text: string) => rules.scanTemplate(text, ['amount'], 'text').issues.map((issue) => issue.kind);
    assert.deepEqual(kinds('₦{ amount } refunded'), ['spaced']);
    assert.deepEqual(kinds('₦{{amount}} refunded'), ['doubled']);
    assert.deepEqual(kinds('₦{amount refunded'), ['unclosed']);
    assert.deepEqual(kinds('₦amount} refunded'), ['unopened']);
    assert.equal(rules.scanTemplate('₦{{amount}', ['amount'], 'text').issues[0].token, '{{amount}');
  });

  test('HTML mode leaves CSS braces alone but still catches broken variables', () => {
    const html = '<style>body{margin:0} a{color:red} @media (max-width:600px){.x{display:none}}</style><p>{first_name}</p>';
    assert.deepEqual(rules.scanTemplate(html, ['first_name'], 'html').issues, []);
    const broken = rules.scanTemplate('<p>Hi {first_name, {colour</p>', ['first_name'], 'html').issues;
    assert.deepEqual(broken.map((issue) => issue.kind), ['unclosed']);
  });

  test('a listed variable outside the identifier pattern still counts as a variable', () => {
    const scan = rules.scanTemplate('Hi {first-name}', ['first-name'], 'text');
    assert.deepEqual(scan.issues, []);
    assert.equal(scan.uses['first-name'], 1);
  });
});

describe('introduced and removed placeholders', () => {
  test('a broken placeholder that is already saved is not reported as new', () => {
    const saved = 'Paid {Amount}';
    assert.deepEqual(rules.introducedIssues(saved, saved, ['amount'], 'text'), []);
    const split = rules.splitIssues(saved, saved, ['amount'], 'text');
    assert.equal(split.existing.length, 1);
  });

  test('another copy of a saved broken placeholder counts as new', () => {
    const introduced = rules.introducedIssues('Paid {Amount}', 'Paid {Amount} of {Amount}', ['amount'], 'text');
    assert.equal(introduced.length, 1);
    assert.equal(introduced[0].token, '{Amount}');
  });

  test('removed variables are reported by name', () => {
    assert.deepEqual(
      rules.removedVariables(CARD_BODY, 'Your card was approved.', CARD_VARIABLES, 'text'),
      CARD_VARIABLES,
    );
    assert.deepEqual(rules.removedVariables('₦{amount} and {amount}', '₦{amount}', ['amount'], 'text'), []);
  });
});

describe('rendering mirrors render_notification and render_email', () => {
  test('doubled braces render with the stray brace the database leaves', () => {
    assert.equal(rules.renderTemplate('₦{{amount}}', { amount: '10,000' }, 'text'), '₦{10,000}');
  });

  test('only supplied variables are replaced and unknown ones stay as typed', () => {
    assert.equal(rules.renderTemplate('{amount} {other} { amount }', { amount: '5' }, 'text'), '5 {other} { amount }');
  });

  test('HTML values are escaped like render_email, plain text values are not', () => {
    const value = `<b>"Tom" & 'Jerry'</b>`;
    assert.equal(rules.renderTemplate('{v}', { v: value }, 'html'), `&lt;b&gt;&quot;Tom&quot; &amp; 'Jerry'&lt;/b&gt;`);
    assert.equal(rules.renderTemplate('{v}', { v: value }, 'text'), value);
  });
});

describe('patch parsing keeps the mobile request shapes', () => {
  test('the mobile notification save is accepted as sent', () => {
    const read = rules.readTemplatePatch(rules.NOTIFICATION_CHANNEL, {
      key: 'card_approved', title: 'Card Approved', body: CARD_BODY, is_active: false,
    });
    assert.ok(read.ok);
    assert.deepEqual(read.request.values, { title: 'Card Approved', body: CARD_BODY });
    assert.equal(read.request.isActive, false);
    assert.equal(read.request.expected, null);
    assert.equal(read.request.reason, null);
  });

  test('the mobile email save is accepted as sent', () => {
    const read = rules.readTemplatePatch(rules.EMAIL_CHANNEL, {
      key: 'new_device_login', subject: 'S', html: '<p>x</p>', is_active: true,
    });
    assert.ok(read.ok);
    assert.deepEqual(read.request.values, { subject: 'S', html: '<p>x</p>' });
  });

  test('flags written as text are read as booleans', () => {
    const off = rules.readTemplatePatch(rules.NOTIFICATION_CHANNEL, { key: 'k', is_active: 'false' });
    assert.ok(off.ok);
    assert.equal(off.request.isActive, false);
    const bad = rules.readTemplatePatch(rules.NOTIFICATION_CHANNEL, { key: 'k', is_active: 'maybe' });
    assert.equal(bad.ok, false);
  });

  test('bad bodies, keys and field types are refused', () => {
    assert.equal(rules.readTemplatePatch(rules.NOTIFICATION_CHANNEL, null).ok, false);
    assert.equal(rules.readTemplatePatch(rules.NOTIFICATION_CHANNEL, { key: '' }).ok, false);
    assert.equal(rules.readTemplatePatch(rules.EMAIL_CHANNEL, { key: 'new-device' }).ok, false);
    const typed = rules.readTemplatePatch(rules.NOTIFICATION_CHANNEL, { key: 'k', title: { text: 'x' } });
    assert.equal(typed.ok, false);
    if (!typed.ok) assert.match(typed.message, /title must be text/);
  });

  test('reason and expected values are read when sent', () => {
    const read = rules.readTemplatePatch(rules.NOTIFICATION_CHANNEL, {
      key: 'k', body: 'b', reason: '  typo  ', expected: { body: 'a', is_active: true, other: 1 },
    });
    assert.ok(read.ok);
    assert.equal(read.request.reason, 'typo');
    assert.deepEqual(read.request.expected, { values: { body: 'a' }, isActive: true });
    const blank = rules.readTemplatePatch(rules.NOTIFICATION_CHANNEL, { key: 'k', reason: '   ' });
    assert.ok(blank.ok);
    assert.equal(blank.request.reason, null);
    const long = rules.readTemplatePatch(rules.NOTIFICATION_CHANNEL, { key: 'k', reason: 'x'.repeat(501) });
    assert.equal(long.ok, false);
    const wrong = rules.readTemplatePatch(rules.NOTIFICATION_CHANNEL, { key: 'k', expected: { body: 4 } });
    assert.equal(wrong.ok, false);
  });
});

describe('edit planning on the server', () => {
  const plan = (current: TemplateRecord, body: Record<string, unknown>, channel = rules.NOTIFICATION_CHANNEL) => {
    const read = rules.readTemplatePatch(channel, { key: current.key, ...body });
    assert.ok(read.ok);
    return rules.planTemplateEdit(channel, current, read.request);
  };

  test('an unchanged mobile save changes nothing', () => {
    const result = plan(cardRecord(), { title: 'Card Approved', body: CARD_BODY, is_active: true });
    assert.ok(result.ok);
    assert.deepEqual(result.plan.changed, []);
  });

  test('a body edit records exactly the before and after', () => {
    const next = '{symbol}{amount_foreign} {card_name} approved. ₦{credit} is in your wallet.';
    const result = plan(cardRecord(), { title: 'Card Approved', body: next, is_active: true });
    assert.ok(result.ok);
    assert.deepEqual(result.plan.changed, ['body']);
    assert.deepEqual(result.plan.before, { body: CARD_BODY });
    assert.deepEqual(result.plan.after, { body: next });
  });

  test('a stale expected value is a conflict, not an overwrite', () => {
    const result = plan(cardRecord(), { body: 'New text', expected: { body: 'An older body' } });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.code, 'STATE_CONFLICT');
    assert.deepEqual(result.details.conflicts, ['body']);
  });

  test('a retry after a save that landed is treated as already saved', () => {
    const result = plan(cardRecord({ body: 'New text' }), { body: 'New text', expected: { body: CARD_BODY } });
    assert.ok(result.ok);
    assert.deepEqual(result.plan.changed, []);
  });

  test('a new unknown placeholder is refused with a suggestion', () => {
    const result = plan(cardRecord(), { body: `${CARD_BODY} {Credit}` });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.code, 'VALIDATION_ERROR');
    assert.match(result.message, /^Body: \{Credit\} is not a variable/);
    const issues = result.details.issues as Array<{ kind: string; token: string; suggestion: string | null }>;
    assert.deepEqual(issues[0], { kind: 'unknown', token: '{Credit}', suggestion: 'credit' });
  });

  test('a saved broken placeholder does not block switching the template off', () => {
    const legacy = cardRecord({ body: 'Paid {Amount}' });
    const result = plan(legacy, { title: 'Card Approved', body: 'Paid {Amount}', is_active: false });
    assert.ok(result.ok);
    assert.deepEqual(result.plan.changed, ['is_active']);
    assert.deepEqual(result.plan.before, { is_active: true });
    assert.deepEqual(result.plan.after, { is_active: false });
  });

  test('empty and over-long text is refused only when it changes', () => {
    const empty = plan(cardRecord(), { title: '   ' });
    assert.equal(empty.ok, false);
    if (!empty.ok) assert.match(empty.message, /title cannot be empty/);
    const long = plan(cardRecord(), { title: 'x'.repeat(101) });
    assert.equal(long.ok, false);
    if (!long.ok) assert.match(long.message, /100 characters or fewer/);
    const legacyLong = cardRecord({ title: 'y'.repeat(150) });
    assert.ok(plan(legacyLong, { title: 'y'.repeat(150), is_active: false }).ok);
    const html = plan(deviceRecord(), { html: `<p>${'z'.repeat(200001)}</p>` }, rules.EMAIL_CHANNEL);
    assert.equal(html.ok, false);
  });

  test('a stale on/off value is a conflict', () => {
    const result = plan(cardRecord({ is_active: false }), { is_active: true, expected: { is_active: true } });
    assert.equal(result.ok, false);
    if (!result.ok) assert.deepEqual(result.details.conflicts, ['is_active']);
  });

  test('the routes select exactly the columns the channel defines', () => {
    assert.match(readFileSync(NOTIFICATION_ROUTE, 'utf8'), new RegExp(`'${rules.templateColumns(rules.NOTIFICATION_CHANNEL)}'`));
    assert.match(readFileSync(EMAIL_ROUTE, 'utf8'), new RegExp(`'${rules.templateColumns(rules.EMAIL_CHANNEL)}'`));
  });
});

describe('text diff', () => {
  test('both sides can be rebuilt from the parts', () => {
    const before = 'Card Approved for {card_name}';
    const after = 'Card approved: {card_name}';
    const result = diff.diffText(before, after);
    assert.equal(diff.sideParts(result, 'before').map((part) => part.text).join(''), before);
    assert.equal(diff.sideParts(result, 'after').map((part) => part.text).join(''), after);
    assert.ok(result.some((part) => part.op === 'delete' && part.text.includes('Approved')));
    assert.ok(result.some((part) => part.op === 'insert' && part.text.includes('approved')));
  });

  test('summaries count change runs and characters', () => {
    const summary = diff.summarizeDiff(diff.diffText('one two three', 'one 2 three four'));
    assert.equal(summary.changes, 2);
    assert.equal(summary.removed, 3);
    assert.equal(summary.added, 6);
  });

  test('long texts are split into clipped hunks around each change', () => {
    const filler = 'lorem ipsum dolor '.repeat(40);
    const before = `start ${filler} middle ${filler} end`;
    const after = `begin ${filler} middle ${filler} finish`;
    const hunks = diff.diffHunks(diff.diffText(before, after), 30);
    assert.equal(hunks.length, 2);
    assert.equal(hunks[0].clippedStart, false);
    assert.equal(hunks[0].clippedEnd, true);
    assert.equal(hunks[1].clippedStart, true);
    assert.equal(hunks[1].clippedEnd, false);
  });

  test('a change too large to compare word by word is shown as one replacement', () => {
    const result = diff.diffText('a b c d', 'w x y z', 4);
    assert.deepEqual(result.map((part) => part.op), ['delete', 'insert']);
  });

  test('identical text produces a single equal part', () => {
    assert.deepEqual(diff.diffText('same', 'same'), [{ op: 'equal', text: 'same' }]);
    assert.deepEqual(diff.diffText('', ''), []);
  });
});

describe('client model', () => {
  test('the list parser keeps valid rows and refuses bodies without templates', () => {
    const select = model.toTemplateList(rules.NOTIFICATION_CHANNEL);
    const rows = select({ templates: [CARD_ROW, { title: 'no key' }, null] });
    assert.ok(rows);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].values.body, CARD_BODY);
    assert.equal(select({ success: true }), null);
  });

  test('the save payload carries only changed fields with what the admin last saw', () => {
    const base = cardRecord();
    const draft = { values: { title: 'Card Approved', body: 'New body {credit}' }, isActive: false };
    assert.deepEqual(model.savePayload(rules.NOTIFICATION_CHANNEL, base, draft, '  fix wording '), {
      key: 'card_approved',
      body: 'New body {credit}',
      is_active: false,
      expected: { body: CARD_BODY, is_active: true },
      reason: 'fix wording',
    });
    assert.equal('reason' in model.savePayload(rules.NOTIFICATION_CHANNEL, base, draft, ''), false);
  });

  test('rebasing keeps the admin’s edits and reports overlapping changes', () => {
    const base = cardRecord();
    const live = cardRecord({ title: 'Approved!', body: 'Their body', updated_at: '2026-10-02T09:00:00+00:00' });
    const untouched = model.rebaseDraft(rules.NOTIFICATION_CHANNEL, base, model.draftOf(base), live);
    assert.deepEqual(untouched.draft.values, { title: 'Approved!', body: 'Their body' });
    assert.deepEqual(untouched.refreshed, ['Title', 'Body']);
    assert.deepEqual(untouched.conflicts, []);
    const mine = { values: { title: 'Card Approved', body: 'My body' }, isActive: true };
    const edited = model.rebaseDraft(rules.NOTIFICATION_CHANNEL, base, mine, live);
    assert.deepEqual(edited.draft.values, { title: 'Approved!', body: 'My body' });
    assert.deepEqual(edited.conflicts, ['Body']);
  });

  test('save failures map to the right outcome', () => {
    assert.equal(model.classifySave(failure({ status: 401, code: 'AUTH_REQUIRED' })).kind, 'expired');
    assert.equal(model.classifySave(failure({ status: 403 })).kind, 'refused');
    assert.equal(model.classifySave(failure({ status: 404 })).kind, 'missing');
    assert.equal(model.classifySave(failure({ status: 409 })).kind, 'stale');
    assert.equal(model.classifySave(failure({ status: 400 })).kind, 'retry');
    assert.equal(model.classifySave(failure({ kind: 'timeout', status: null, code: null, outcomeUnknown: true })).kind, 'unknown');
    const receipt = model.toSaveReceipt(rules.NOTIFICATION_CHANNEL)({ changed: true, template: CARD_ROW, audit_recorded: false, warning: 'w' });
    assert.equal(receipt.template?.key, 'card_approved');
    assert.equal(receipt.auditRecorded, false);
    assert.equal(model.classifySave({ ok: true, data: receipt, status: 200, requestId: null }).kind, 'saved');
  });

  test('problems separate new errors from issues already saved', () => {
    const field = rules.NOTIFICATION_CHANNEL.fields[1];
    const kept = model.fieldProblems(field, 'Paid {Amount}', 'Paid {Amount}', ['amount']);
    assert.deepEqual(kept.errors, []);
    assert.equal(kept.warnings.length, 1);
    const added = model.fieldProblems(field, '₦{amount}', '₦{amount} {Amont}', ['amount']);
    assert.equal(added.errors.length, 1);
    const cleared = model.fieldProblems(field, '₦{amount} refunded', '', ['amount']);
    assert.deepEqual(cleared.errors, ['The body cannot be empty.']);
    assert.deepEqual(cleared.removed, ['amount']);
  });

  test('variables are inserted at the caret, or at the end without one', () => {
    assert.deepEqual(model.insertToken('Paid  now', '{amount}', 5, 5), { value: 'Paid {amount} now', caret: 13 });
    assert.deepEqual(model.insertToken('Paid', '{amount}', null, null), { value: 'Paid{amount}', caret: 12 });
    assert.deepEqual(model.insertToken('Paid XX', '{amount}', 5, 7), { value: 'Paid {amount}', caret: 13 });
  });

  test('search, sort and stats work on the loaded list', () => {
    const rows = [
      cardRecord(),
      cardRecord({ key: 'withdrawal_failed', title: 'Withdrawal Failed', body: '₦{amount} refunded', variables: ['amount'], is_active: false, updated_at: '2026-10-02T09:00:00+00:00' }),
    ];
    assert.deepEqual(model.filterTemplates(rules.NOTIFICATION_CHANNEL, rows, 'refund').map((row) => row.key), ['withdrawal_failed']);
    assert.deepEqual(model.sortTemplates(rows, { key: 'updated', dir: 'desc' }).map((row) => row.key), ['withdrawal_failed', 'card_approved']);
    assert.deepEqual(model.sortTemplates(rows, { key: 'name', dir: 'desc' }).map((row) => row.key), ['withdrawal_failed', 'card_approved']);
    assert.deepEqual(model.templateStats(rows), { total: 2, active: 1, inactive: 1, lastChanged: '2026-10-02T09:00:00+00:00' });
    assert.equal(model.templateName(rows[1]), 'Withdrawal failed');
  });

  test('every seeded variable has a sample and a hint', () => {
    const seeded = [
      ...CARD_VARIABLES, 'card_label', 'reason', 'amount', 'bank_name', 'account_last4', 'provider', 'type', 'hours', 'note',
      ...DEVICE_ROW.variables, 'severity_upper', 'severity_color', 'alert_type', 'alert_subject', 'detail_json', 'fired_at',
    ];
    for (const name of seeded) {
      assert.ok(model.variableHint(name), name);
      assert.notEqual(model.defaultSample(name), `[${name}]`, name);
    }
    assert.equal(model.defaultSample('mystery'), '[mystery]');
  });

  test('every variable the canonical template seeds declare has a sample and a hint', { skip: !existsSync(SCHEMA_FILE) }, () => {
    const schema = readFileSync(SCHEMA_FILE, 'utf8');
    const seeds = [...schema.matchAll(/INSERT INTO (?:notification|email)_templates\b[\s\S]*?ON CONFLICT/g)].map((match) => match[0]);
    assert.ok(seeds.length > 0, 'no template seeds were found in schema.sql');
    const declared = new Set(seeds
      .flatMap((seed) => [...seed.matchAll(/ARRAY\[([^\]]*)\]/g)])
      .flatMap((array) => [...array[1].matchAll(/'([^']+)'/g)].map((name) => name[1])));
    for (const name of ['amount', 'note', 'hours', 'first_name']) assert.ok(declared.has(name), name);
    for (const name of declared) {
      assert.ok(model.variableHint(name), name);
      assert.notEqual(model.defaultSample(name), `[${name}]`, name);
    }
  });
});

describe('confirmation dialogs', () => {
  test('a text change shows the exact before and after', () => {
    const template = cardRecord();
    const options = dialogs.saveOptions({
      channel: rules.NOTIFICATION_CHANNEL,
      template,
      changes: [{ field: rules.NOTIFICATION_CHANNEL.fields[0], before: 'Card Approved', after: 'Card approved' }],
      active: null,
      conflicts: [],
      removed: [],
    });
    assert.equal(options.title, 'Save changes to Card approved?');
    assert.equal(options.tone, 'default');
    assert.equal(options.confirmLabel, 'Save changes');
    assert.equal(options.details?.[0].value, 'card_approved');
    assert.equal(options.reason?.required, undefined);
    const html = render(options.message as ReactElement);
    assert.match(textOf(html), /Before Card Approved After Card approved/);
    assert.equal(tagsOf(html, 'del').length, 1);
    assert.equal(tagsOf(html, 'ins').length, 1);
  });

  test('switching a notification off is a danger confirmation that says nothing is sent later', () => {
    const options = dialogs.saveOptions({
      channel: rules.NOTIFICATION_CHANNEL,
      template: cardRecord(),
      changes: [],
      active: { before: true, after: false },
      conflicts: ['Body'],
      removed: [{ label: 'Body', names: ['credit'] }],
    });
    assert.equal(options.tone, 'danger');
    assert.equal(options.title, 'Switch off Card approved?');
    assert.equal(options.confirmLabel, 'Switch off');
    const lines = options.consequences ?? [];
    assert.match(lines[0], /Another admin changed the body/);
    assert.match(lines[1], /not sent later/);
    assert.match(lines[2], /no longer includes \{credit\}/);
    assert.match(textOf(render(options.details?.[1].value as ReactElement)), /Sending → to Switched off/);
  });

  test('switching an email back on does not promise to resend skipped emails', () => {
    const lines = dialogs.saveConsequences({
      channel: rules.EMAIL_CHANNEL,
      template: deviceRecord(),
      changes: [],
      active: { before: false, after: true },
      conflicts: [],
      removed: [],
    });
    assert.deepEqual(lines, ['This email is sent again for new events.']);
  });

  test('HTML changes are summarised in clipped hunks', () => {
    const filler = '<p>Unchanged paragraph text.</p>'.repeat(30);
    const before = `<h1>Hello</h1>${filler}<p>Bye</p>`;
    const after = `<h1>Welcome</h1>${filler}<p>Bye</p>`;
    const html = render(createElement(parts.FieldDiff, {
      change: { field: rules.EMAIL_CHANNEL.fields[1], before, after },
    }));
    assert.match(textOf(html), /1 change · 5 characters removed · 7 characters added/);
    assert.match(textOf(html), /Later text not shown/);
    assert.ok(!textOf(html).includes('Bye'));
  });
});

describe('preview parts', () => {
  test('the push preview fills sample values and marks text users would see as typed', () => {
    const html = render(createElement(parts.PushPreview, {
      channel: rules.NOTIFICATION_CHANNEL,
      variables: ['amount'],
      values: { title: 'Withdrawal Failed', body: '₦{amount} refunded {Amount}' },
      samples: { amount: '10,000' },
    }));
    assert.match(textOf(html), /Withdrawal Failed ₦ ?10,000 refunded \{Amount\}/);
    assert.ok(html.includes('class="unresolved"'));
    assert.ok(html.includes('title="{amount}"'));
  });

  test('variable chips describe their use and stay inert when read-only', () => {
    const editable = render(createElement(parts.VariableChips, {
      variables: ['amount', 'hours'], uses: { amount: 2 }, onInsert: () => undefined,
    }));
    const buttons = tagsOf(editable, 'button');
    assert.equal(buttons.length, 2);
    assert.match(buttons[0]['aria-label'], /^Insert \{amount\}, used 2 times\. Naira amount$/);
    assert.match(buttons[1]['aria-label'], /^Insert \{hours\}, not used yet\./);
    const readOnly = render(createElement(parts.VariableChips, { variables: ['amount'], uses: {} }));
    assert.equal(tagsOf(readOnly, 'button').length, 0);
    const none = render(createElement(parts.VariableChips, { variables: [], uses: {} }));
    assert.match(textOf(none), /no variables/);
  });

  test('the email preview renders inside a fully sandboxed frame', () => {
    const html = render(createElement(emailParts.EmailPreview, {
      channel: rules.EMAIL_CHANNEL,
      variables: DEVICE_ROW.variables,
      values: { subject: 'Hi {first_name}', html: '<p onclick="steal()">Hi {first_name}<script>alert(1)</script></p>' },
      samples: { first_name: '<Ada>' },
    }));
    const frames = tagsOf(html, 'iframe');
    assert.equal(frames.length, 1);
    const frame = Object.fromEntries(Object.entries(frames[0]).map(([name, value]) => [name.toLowerCase(), value]));
    assert.equal(frame.sandbox, '');
    assert.equal(frame.referrerpolicy, 'no-referrer');
    assert.match(frame.srcdoc, /Content-Security-Policy/);
    assert.match(frame.srcdoc, /&amp;lt;Ada&amp;gt;/);
    assert.match(textOf(html), /Subject Hi <Ada>/);
    assert.equal(tagsOf(html, 'script').length, 0);
  });
});

describe('email preview document', () => {
  test('remote content is blocked unless switched on', () => {
    const blocked = email.previewDocument('<img src="https://x.test/a.png">', { remoteImages: false });
    assert.match(blocked, /default-src 'none'; img-src data:; font-src data:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'/);
    assert.match(blocked, /<base target="_blank">/);
    assert.match(blocked, /<meta name="referrer" content="no-referrer">/);
    assert.match(blocked, /<meta name="color-scheme" content="light">/);
    assert.match(blocked, /<body><img src="https:\/\/x\.test\/a\.png"><\/body>/);
    assert.match(email.previewDocument('', { remoteImages: true }), /img-src data: https:; font-src data: https:/);
  });

  test('links in the preview cannot pick a target that would open them inside the frame', () => {
    assert.equal(
      email.withoutLinkTargets('<a href="https://x.test" target="_self">A</a><a target=_top href="/b">B</a><p target="x">C</p>'),
      '<a href="https://x.test">A</a><a href="/b">B</a><p target="x">C</p>',
    );
    assert.match(
      email.previewDocument('<a href="https://x.test" target=\'_parent\'>A</a>', { remoteImages: false }),
      /<body><a href="https:\/\/x\.test">A<\/a><\/body>/,
    );
  });

  test('the plain-text view matches what send-email strips', () => {
    assert.equal(email.plainTextOf('<style>p{margin:0}</style><p>A &amp; B</p>\n<p>C</p>'), 'p{margin:0}A &amp; B C');
  });

  test('remote references are counted and samples are limited to template variables', () => {
    assert.equal(
      email.remoteReferenceCount('<img src="https://a/x.png"><td background=\'http://b/y.png\'><div style="background:url(https://c/z.png)">'),
      3,
    );
    assert.equal(email.remoteReferenceCount('<img src="data:image/png;base64,AA">'), 0);
    assert.equal(email.remoteReferenceCount('<img src="//cdn.test/logo.png"><div style="background:url(//cdn.test/bg.png)">'), 2);
    assert.deepEqual(email.pickSamples({ ip: '1.2.3.4', stale: 'x' }, ['ip', 'when']), { ip: '1.2.3.4', when: '' });
  });
});

describe('review fixes', () => {
  test('broken placeholder ranges split text into marked runs', () => {
    const text = 'Sent { amount } and {amount';
    const scan = rules.scanTemplate(text, ['amount'], 'text');
    const ranges = model.brokenRanges(scan.issues);
    const runs = model.markedRuns(text, 0, ranges);
    assert.deepEqual(runs, [
      { text: 'Sent ', marked: false },
      { text: '{ amount }', marked: true },
      { text: ' and ', marked: false },
      { text: '{amount', marked: true },
    ]);
    assert.deepEqual(model.markedRuns('abc', 10, [[0, 11], [12, 20]]), [
      { text: 'a', marked: true },
      { text: 'b', marked: false },
      { text: 'c', marked: true },
    ]);
  });

  test('the push preview marks spaced and doubled placeholders users would see as typed', () => {
    const html = render(createElement(parts.PushPreview, {
      channel: rules.NOTIFICATION_CHANNEL,
      variables: ['amount'],
      values: { title: 'Paid { amount }', body: 'Got {{amount}}' },
      samples: { amount: '10,000' },
    }));
    assert.match(textOf(html), /Paid \{ amount \}\s*Got\s*\{\s*10,000\s*\}/);
    assert.ok(html.includes('<span class="unresolved">{ amount }</span>'));
    assert.equal((html.match(/<span class="unresolved">[{}]<\/span>/g) ?? []).length, 2);
  });

  test('changes beyond the first six stay reachable in the confirmation', () => {
    const block = `<p>${'x'.repeat(200)}</p>`;
    const before = Array.from({ length: 8 }, (_, index) => `<b>old${index}</b>${block}`).join('');
    const after = Array.from({ length: 8 }, (_, index) => `<b>new${index}</b>${block}`).join('');
    const html = render(createElement(parts.FieldDiff, {
      change: { field: rules.EMAIL_CHANNEL.fields[1], before, after },
    }));
    assert.ok(html.includes('<details'));
    assert.match(textOf(html), /Show 2 more changes/);
    assert.ok(textOf(html).includes('new7'));
    assert.ok(!textOf(html).includes('not shown here'));
  });
});

describe('hard rules', () => {
  const owned = () => [
    ...readdirSync(NOTIFICATION_DIR).filter((name) => /\.(ts|tsx)$/.test(name)).map((name) => join(NOTIFICATION_DIR, name)),
    ...readdirSync(EMAIL_DIR).filter((name) => /\.(ts|tsx)$/.test(name)).map((name) => join(EMAIL_DIR, name)),
    NOTIFICATION_ROUTE,
    EMAIL_ROUTE,
  ];

  test('owned sources carry no prose comments and no inline styles', () => {
    for (const file of owned()) {
      const source = readFileSync(file, 'utf8');
      assert.doesNotMatch(source, /\/\*/, file);
      assert.doesNotMatch(source, /(^|\s)\/\/\s/m, file);
      assert.doesNotMatch(source, /style=\{/, file);
    }
  });

  test('owned sources spell invisible and bidirectional characters as escapes', () => {
    const hidden = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u200B-\u200F\u202A-\u202E\u2066-\u2069\uFEFF]/;
    for (const file of [...owned(), fileURLToPath(import.meta.url)]) {
      assert.doesNotMatch(readFileSync(file, 'utf8'), hidden, file);
    }
  });

  test('the stylesheets use tokens only', () => {
    const colour = /#[0-9a-f]{3,8}\b|\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\(|\b(?:transparent|currentcolor|white|black|red|green|blue|gray|grey|orange|yellow|purple|pink)\b/i;
    for (const dir of [NOTIFICATION_DIR, EMAIL_DIR]) {
      const css = readFileSync(join(dir, 'page.module.css'), 'utf8');
      for (const [, property, value] of css.matchAll(/([\w-]+)\s*:\s*([^;{}]+);/g)) {
        assert.doesNotMatch(value, colour, `${property}: ${value}`);
        if (property === 'z-index') assert.match(value.trim(), /^var\(--z-[\w-]+\)$/);
      }
      assert.doesNotMatch(css, /\/\*/);
    }
  });

  test('each route keeps its own permission pair and the shared rules', () => {
    const pairs: Array<[string, string, string]> = [
      [NOTIFICATION_ROUTE, 'notification_templates', 'email_templates'],
      [EMAIL_ROUTE, 'email_templates', 'notification_templates'],
    ];
    for (const [file, own, other] of pairs) {
      const source = readFileSync(file, 'utf8');
      const get = source.slice(source.indexOf('export async function GET'), source.indexOf('export async function PATCH'));
      const patch = source.slice(source.indexOf('export async function PATCH'));
      assert.match(get, new RegExp(`requireAdmin\\('${own}\\.read'\\)`));
      assert.match(patch, new RegExp(`requireAdmin\\('${own}\\.write'\\)`));
      assert.doesNotMatch(source, new RegExp(`'${other}\\.`));
      assert.doesNotMatch(source, /requireSuperAdmin|requireAdminAny|requireAdminAll|NextResponse\.json\(/);
      assert.match(source, /writeAudit\(/);
      assert.match(source, /ok\(\{ templates: data \?\? \[\] \}\)/);
      assert.match(source, /from '\.\.\/\.\.\/\(dashboard\)\/notification-templates\/templateRules'/);
    }
  });

  test('the pages gate editing on the same permission their route enforces', () => {
    const notification = readFileSync(join(NOTIFICATION_DIR, 'page.tsx'), 'utf8');
    const emailPage = readFileSync(join(EMAIL_DIR, 'page.tsx'), 'utf8');
    assert.match(notification, /writePermission: 'notification_templates\.write'/);
    assert.match(notification, /readPermission: 'notification_templates\.read'/);
    assert.match(emailPage, /writePermission: 'email_templates\.write'/);
    assert.match(emailPage, /readPermission: 'email_templates\.read'/);
    assert.match(readFileSync(join(NOTIFICATION_DIR, 'TemplatesPage.tsx'), 'utf8'), /useCan\(config\.writePermission\)/);
  });
});
