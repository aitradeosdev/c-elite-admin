import { before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as F from '../app/lib/fieldFormat.ts';
import type { FieldFormat, FieldSelection } from '../app/lib/fieldFormat.ts';
import { loadAppModule } from './support/uiHarness.ts';

type RulesModule = typeof import('../app/(dashboard)/field-builder/rules.ts');

const ADMIN_COPY = fileURLToPath(new URL('../app/lib/fieldFormat.ts', import.meta.url));
const APP_COPY = fileURLToPath(new URL('../../CardElite/lib/fieldFormat.ts', import.meta.url));
const APP_SCREEN = fileURLToPath(new URL('../../CardElite/app/sell/card-detail.tsx', import.meta.url));
const SCHEMA_FILE = fileURLToPath(new URL('../../schema.sql', import.meta.url));
const TEST_FILE = fileURLToPath(import.meta.url);

function formatOf(kind: string, pattern: string | null): FieldFormat {
  const format = F.fieldFormatOf(kind, pattern);
  assert.ok(format, `${kind} ${pattern}`);
  return format;
}

const card = formatOf('card_number', null);
const expiry = formatOf('expiry_date', null);
const cvv = formatOf('cvv', null);
const custom = formatOf('custom', '####-####-AAAA');
const prefix = formatOf('custom', '(###) ###-####');
const mixed = formatOf('custom', '****-******-****');
const ALL = [card, expiry, cvv, custom, prefix, mixed];

function luhnDigit(body: string): string {
  for (let d = 0; d <= 9; d += 1) if (F.luhnValid(body + d)) return String(d);
  throw new Error('no digit');
}

function seeded(start: number): (n: number) => number {
  let seed = start;
  return (n) => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed % n;
  };
}

interface Screen {
  native: string;
  caret: number;
  shown: string;
  lastRaw: string;
  caretPushes: number;
}

function androidReplace(oldText: string, oldCaret: number, newText: string): number {
  if (oldCaret >= oldText.length) return newText.length;
  if (oldCaret <= 0) return 0;
  return Math.floor((oldCaret * newText.length) / oldText.length);
}

function intended(format: FieldFormat, shown: string, raw: string, start: number, removed: number, inserted: number): { value: string; caret: number } {
  const slot = (j: number) => format.mask[j] === '#' || format.mask[j] === 'A' || format.mask[j] === '*';
  const slots = (text: string) => {
    let n = 0;
    for (let j = 0; j < text.length; j += 1) if (slot(j)) n += 1;
    return n;
  };
  const afterSlots = (value: string, k: number) => {
    let j = 0;
    let n = 0;
    while (j < value.length && (k === 0 ? !slot(j) : n < k)) {
      if (slot(j)) n += 1;
      j += 1;
    }
    return j;
  };
  let next = raw;
  let cut = start + inserted;
  if (inserted === 0 && removed === 1 && start < format.mask.length && !slot(start) && F.formatFieldValue(format, raw) === shown) {
    let j = start - 1;
    while (j >= 0 && !slot(j)) j -= 1;
    if (j < 0) return { value: shown, caret: start };
    next = shown.slice(0, j) + shown.slice(j + 1);
    cut = j;
  }
  const value = F.formatFieldValue(format, next);
  if (value === raw) return { value, caret: cut };
  if (cut >= next.length) return { value, caret: value.length };
  return { value, caret: afterSlots(value, slots(F.formatFieldValue(format, next.slice(0, cut)))) };
}

function device(format: FieldFormat) {
  const s: Screen = { native: '', caret: 0, shown: '', lastRaw: '', caretPushes: 0 };
  const max = F.fieldFormatMaxLength(format);
  const js = (selection: FieldSelection, apply: boolean) => {
    const raw = s.native;
    const r = F.applyFieldEdit(format, s.shown, s.lastRaw, raw, selection);
    s.lastRaw = raw;
    s.shown = r.value;
    if (apply && r.value !== raw) {
      const mapped = androidReplace(raw, s.caret, r.value);
      s.native = r.value;
      if (r.caret !== null) s.caretPushes += 1;
      s.caret = r.caret !== null ? r.caret : mapped;
    }
  };
  const insert = (text: string) => {
    const kept = text.slice(0, Math.max(0, max - s.native.length));
    s.native = s.native.slice(0, s.caret) + kept + s.native.slice(s.caret);
    s.caret += kept.length;
  };
  return {
    s,
    type(text: string, apply = true) {
      const selection = { start: s.caret, end: s.caret };
      insert(text);
      js(selection, apply);
    },
    back() {
      if (s.caret === 0) return;
      const selection = { start: s.caret, end: s.caret };
      s.native = s.native.slice(0, s.caret - 1) + s.native.slice(s.caret);
      s.caret -= 1;
      js(selection, true);
    },
    select(a: number, b: number, text: string) {
      const selection = { start: a, end: b };
      s.native = s.native.slice(0, a) + s.native.slice(b);
      s.caret = a;
      insert(text);
      js(selection, true);
    },
    move(c: number) {
      s.caret = c;
    },
  };
}

describe('field formats: kinds and patterns', () => {
  test('the four formats and their masks', () => {
    assert.deepEqual(F.INPUT_FORMATS, ['card_number', 'expiry_date', 'cvv', 'custom']);
    assert.equal(card.mask, '#### #### #### #### ###');
    assert.equal(expiry.mask, '##/##');
    assert.equal(cvv.mask, '####');
    assert.equal(custom.mask, '####-####-AAAA');
    assert.equal(F.isInputFormat('expiry_date'), true);
    assert.equal(F.isInputFormat('expiry'), false);
  });

  test('anything else is not a usable format', () => {
    for (const kind of [null, undefined, '', 'iban', 'CARD_NUMBER', 'expiry']) assert.equal(F.fieldFormatOf(kind, null), null);
    for (const pattern of [null, undefined, '', '-', '####-', ' ####', '##é#', 'GC-####', '#'.repeat(65)]) {
      assert.equal(F.fieldFormatOf('custom', pattern), null, String(pattern));
    }
    assert.equal(F.fieldFormatOf('card_number', '####'), null);
    assert.equal(F.fieldFormatOf('cvv', ''), null);
  });

  test('accepted patterns', () => {
    for (const pattern of ['####-####-AAAA', '(###) ###-####', '****.****', '#'.repeat(64), '+### ###', 'A', '##--##', '#/A_*']) {
      assert.equal(F.patternProblem(pattern), null, pattern);
    }
  });

  test('refused patterns and their messages', () => {
    assert.equal(F.patternProblem(''), 'Enter the pattern users must follow.');
    assert.equal(F.patternProblem('#'.repeat(65)), 'Keep the pattern to 64 characters or fewer.');
    const symbols = 'Use only #, A and * for what users type, with spaces or symbols such as - / . between them.';
    for (const pattern of ['GC-####', '1###', 'a###', '###a', 'X###', '##é#', '##\t#', '####\n']) {
      assert.equal(F.patternProblem(pattern), symbols, JSON.stringify(pattern));
    }
    assert.equal(F.patternProblem(' ####'), 'Remove the space at the start of the pattern.');
    for (const pattern of ['####-', '#### ', '-', '(###)']) assert.equal(F.patternProblem(pattern), 'End the pattern with #, A or *.', pattern);
  });
});

describe('field formats: the card number check', () => {
  test('published test numbers pass', () => {
    for (const n of ['4242424242424242', '4111111111111111', '5555555555554444', '378282246310005', '6011111111111117', '4222222222222', '3566002020360505', '79927398713']) {
      assert.equal(F.luhnValid(n), true, n);
    }
  });

  test('a wrong check digit or anything but digits fails', () => {
    for (const n of ['4242424242424241', '4111111111111112', '', '42a2', '4242 4242']) assert.equal(F.luhnValid(n), false, n);
  });
});

describe('field formats: formatting as users type', () => {
  test('card numbers are grouped in fours with no trailing space', () => {
    assert.equal(F.formatFieldValue(card, '4242424242424242'), '4242 4242 4242 4242');
    assert.equal(F.formatFieldValue(card, '4242'), '4242');
    assert.equal(F.formatFieldValue(card, '4242 '), '4242');
    assert.equal(F.formatFieldValue(card, '42424'), '4242 4');
    assert.equal(F.formatFieldValue(card, '4242-4242 4242.4242'), '4242 4242 4242 4242');
    assert.equal(F.formatFieldValue(card, '4'.repeat(25)), '4444 4444 4444 4444 444');
    assert.equal(F.formatFieldValue(card, '378282246310005'), '3782 8224 6310 005');
    assert.equal(F.formatFieldValue(card, 'ab12'), '12');
  });

  test('expiry dates get the slash with the third digit', () => {
    assert.equal(F.formatFieldValue(expiry, '1'), '1');
    assert.equal(F.formatFieldValue(expiry, '12'), '12');
    assert.equal(F.formatFieldValue(expiry, '123'), '12/3');
    assert.equal(F.formatFieldValue(expiry, '1227'), '12/27');
    assert.equal(F.formatFieldValue(expiry, '12/27'), '12/27');
    assert.equal(F.formatFieldValue(expiry, '12/2027'), '12/20');
  });

  test('CVV keeps up to four digits', () => {
    assert.equal(F.formatFieldValue(cvv, '12345'), '1234');
    assert.equal(F.formatFieldValue(cvv, '1a2'), '12');
  });

  test('custom patterns keep case, skip what does not fit and add fixed characters', () => {
    assert.equal(F.formatFieldValue(custom, '12345678abcd'), '1234-5678-abcd');
    assert.equal(F.formatFieldValue(custom, '1234 5678 ABCD'), '1234-5678-ABCD');
    assert.equal(F.formatFieldValue(custom, '12x34'), '1234');
    assert.equal(F.formatFieldValue(custom, '1234'), '1234');
    assert.equal(F.formatFieldValue(custom, '12345'), '1234-5');
    assert.equal(F.formatFieldValue(prefix, '5'), '(5');
    assert.equal(F.formatFieldValue(prefix, '5551234567'), '(555) 123-4567');
    assert.equal(F.formatFieldValue(prefix, '(555) 123-4567'), '(555) 123-4567');
    assert.equal(F.formatFieldValue(prefix, '('), '');
    assert.equal(F.formatFieldValue(mixed, 'aq3x7fzxwd8pfr'), 'aq3x-7fzxwd-8pfr');
    assert.equal(F.formatFieldValue(formatOf('custom', '##--##'), '1234'), '12--34');
  });

  test('formatting is idempotent and never longer than the mask', () => {
    const chars = '0123456789abcXYZ -/#*()';
    const rnd = seeded(7);
    for (const format of ALL) {
      for (let t = 0; t < 2000; t += 1) {
        let raw = '';
        const len = rnd(30);
        for (let i = 0; i < len; i += 1) raw += chars[rnd(chars.length)];
        const once = F.formatFieldValue(format, raw);
        assert.equal(F.formatFieldValue(format, once), once, `${format.mask} ${JSON.stringify(raw)}`);
        assert.ok(once.length <= F.fieldFormatMaxLength(format));
      }
    }
  });
});

describe('field formats: when users can continue', () => {
  test('a card number needs 13 to 19 digits and a valid check digit', () => {
    assert.equal(F.isFieldValueComplete(card, '4242 4242 4242 4242'), true);
    assert.equal(F.isFieldValueComplete(card, '4242 4242 4242 4241'), false);
    assert.equal(F.isFieldValueComplete(card, '4222 2222 2222 2'), true);
    assert.equal(F.isFieldValueComplete(card, '3782 8224 6310 005'), true);
    const body18 = '424242424242424242';
    assert.equal(F.isFieldValueComplete(card, F.formatFieldValue(card, body18 + luhnDigit(body18))), true);
    const body11 = '42424242424';
    assert.equal(F.isFieldValueComplete(card, F.formatFieldValue(card, body11 + luhnDigit(body11))), false);
    assert.equal(F.isFieldValueComplete(card, '4242424242424242'), false);
    assert.equal(F.fieldValueProblem(card, '4242 4242 4242 4241'), 'Check the card number.');
    assert.equal(F.fieldValueProblem(card, '4242 4242 4242 4242'), null);
    assert.equal(F.fieldValueProblem(card, ''), null);
  });

  test('an expiry date needs a month from 01 to 12, and past dates are accepted', () => {
    assert.equal(F.isFieldValueComplete(expiry, '12/27'), true);
    assert.equal(F.isFieldValueComplete(expiry, '01/19'), true);
    assert.equal(F.isFieldValueComplete(expiry, '00/27'), false);
    assert.equal(F.isFieldValueComplete(expiry, '13/27'), false);
    assert.equal(F.isFieldValueComplete(expiry, '12/2'), false);
    assert.equal(F.isFieldValueComplete(expiry, '1227'), false);
    assert.equal(F.fieldValueProblem(expiry, '13/27'), 'Enter a valid date as MM/YY.');
  });

  test('a CVV needs 3 or 4 digits', () => {
    assert.equal(F.isFieldValueComplete(cvv, '123'), true);
    assert.equal(F.isFieldValueComplete(cvv, '1234'), true);
    assert.equal(F.isFieldValueComplete(cvv, '12'), false);
    assert.equal(F.fieldValueProblem(cvv, '12'), 'Enter the 3 or 4 digit CVV.');
  });

  test('a custom pattern needs every slot filled', () => {
    assert.equal(F.isFieldValueComplete(custom, '1234-5678-ABCD'), true);
    assert.equal(F.isFieldValueComplete(custom, '1234-5678-abcd'), true);
    assert.equal(F.isFieldValueComplete(custom, '1234-5678-ABC'), false);
    assert.equal(F.isFieldValueComplete(custom, '12345678ABCD'), false);
    assert.equal(F.fieldValueProblem(custom, '1234'), 'Use this format: 0000-0000-AAAA');
    assert.equal(F.isFieldValueComplete(prefix, '(555) 123-4567'), true);
  });

  test('examples, keyboards and lengths', () => {
    assert.equal(F.isFieldValueFull(cvv, '1234'), true);
    assert.equal(F.isFieldValueFull(cvv, '123'), false);
    assert.equal(F.isFieldValueFull(card, '4242 4242 4242 4242'), false);
    assert.deepEqual(ALL.map(F.fieldFormatExample), ['0000 0000 0000 0000', 'MM/YY', '000', '0000-0000-AAAA', '(000) 000-0000', 'XXXX-XXXXXX-XXXX']);
    assert.deepEqual(ALL.map(F.fieldFormatDigitsOnly), [true, true, true, false, true, false]);
    assert.deepEqual([card, expiry, cvv, custom, prefix].map(F.fieldFormatMaxLength), [23, 5, 4, 14, 14]);
    assert.ok(F.fieldFormatMaxLength(formatOf('custom', '#'.repeat(F.PATTERN_MAX))) < 200);
  });
});

describe('field formats: editing on a simulated Android text box', () => {
  test('typing at the end never moves the cursor off the end', () => {
    const d = device(card);
    for (const ch of '4242424242424242') d.type(ch);
    assert.equal(d.s.native, '4242 4242 4242 4242');
    assert.equal(d.s.caret, d.s.native.length);
    assert.equal(d.s.caretPushes, 0);
  });

  test('deleting from the end drops the trailing separator', () => {
    const d = device(card);
    for (const ch of '42424') d.type(ch);
    assert.equal(d.s.native, '4242 4');
    d.back();
    assert.equal(d.s.native, '4242');
    assert.equal(d.s.caret, 4);
  });

  test('typing before a separator lands the cursor after the new digit', () => {
    const d = device(card);
    for (const ch of '42424242') d.type(ch);
    d.move(4);
    d.type('9');
    assert.equal(d.s.native, '4242 9424 2');
    assert.equal(d.s.caret, 6);
    d.type('8');
    assert.equal(d.s.native, '4242 9842 42');
  });

  test('backspace on a separator deletes the digit before it', () => {
    const d = device(card);
    for (const ch of '42424242') d.type(ch);
    d.move(5);
    d.back();
    assert.equal(d.s.native, '4244 242');
    assert.equal(d.s.caret, 3);
  });

  test('backspace over the slash removes the month digit before it', () => {
    const d = device(expiry);
    for (const ch of '1227') d.type(ch);
    assert.equal(d.s.native, '12/27');
    d.move(3);
    d.back();
    assert.equal(d.s.native, '12/7');
    assert.equal(d.s.caret, 1);
  });

  test('a fixed opening character goes only with the last digit', () => {
    const d = device(prefix);
    for (const ch of '12') d.type(ch);
    assert.equal(d.s.native, '(12');
    d.move(1);
    d.back();
    assert.equal(d.s.native, '(12');
    assert.equal(d.s.caret, 0);
    d.move(3);
    d.back();
    d.back();
    assert.equal(d.s.native, '');
  });

  test('paste in the middle, select all, and a keystroke that beats the app update', () => {
    const pasted = device(card);
    for (const ch of '42424242') pasted.type(ch);
    pasted.move(5);
    pasted.type('1111');
    assert.equal(pasted.s.native, '4242 1111 4242');
    assert.equal(pasted.s.caret, 9);
    const replaced = device(card);
    for (const ch of '42424242') replaced.type(ch);
    replaced.select(0, replaced.s.native.length, '5');
    assert.equal(replaced.s.native, '5');
    assert.equal(replaced.s.caret, 1);
    const raced = device(card);
    for (const ch of '4242') raced.type(ch);
    raced.type('4', false);
    assert.equal(raced.s.native, '42424');
    raced.type('4');
    assert.equal(raced.s.native, '4242 44');
    assert.equal(raced.s.caret, 7);
  });

  test('typing past the end of a full value changes nothing', () => {
    const d = device(cvv);
    for (const ch of '12345') d.type(ch);
    assert.equal(d.s.native, '1234');
  });

  test('an edit inside a run of equal characters keeps the cursor at the edit', () => {
    const typed = device(card);
    for (const ch of '411111111111111') typed.type(ch);
    assert.equal(typed.s.native, '4111 1111 1111 111');
    typed.move(1);
    typed.type('1');
    assert.equal(typed.s.native, '4111 1111 1111 1111');
    assert.equal(typed.s.caret, 2);
    const deleted = device(card);
    for (const ch of '41111111') deleted.type(ch);
    deleted.move(2);
    deleted.back();
    assert.equal(deleted.s.native, '4111 111');
    assert.equal(deleted.s.caret, 1);
    const month = device(expiry);
    for (const ch of '111') month.type(ch);
    assert.equal(month.s.native, '11/1');
    month.move(0);
    month.type('1');
    assert.equal(month.s.native, '11/11');
    assert.equal(month.s.caret, 1);
    const replaced = device(card);
    for (const ch of '41111111') replaced.type(ch);
    replaced.select(1, 3, '1');
    assert.equal(replaced.s.native, '4111 111');
    assert.equal(replaced.s.caret, 2);
  });

  test('without a cursor that fits the change, the edit is found by comparing the texts', () => {
    assert.deepEqual(F.applyFieldEdit(card, '4242 4242', '4242 4242', '42429 4242', null), { value: '4242 9424 2', caret: 6 });
    assert.deepEqual(F.applyFieldEdit(card, '4242 4242', '4242 4242', '42424242', null), { value: '4244 242', caret: 3 });
    assert.deepEqual(F.applyFieldEdit(card, '4242 4242', '4242 4242', '42429 4242', { start: 9, end: 9 }), { value: '4242 9424 2', caret: 6 });
    assert.deepEqual(F.applyFieldEdit(card, '4242 4242', '4242 4242', '42429 4242', { start: 12, end: 12 }), { value: '4242 9424 2', caret: 6 });
  });

  test('random edits leave a canonical value on screen and the cursor just after the edited slot', () => {
    const rnd = seeded(11);
    const alphabet = '0123456789aB -(';
    let checked = 0;
    for (const format of ALL) {
      const max = F.fieldFormatMaxLength(format);
      for (let run = 0; run < 300; run += 1) {
        const d = device(format);
        for (let step = 0; step < 40; step += 1) {
          const before = d.s.native;
          const caret = d.s.caret;
          const synced = d.s.native === d.s.shown;
          let raw = before;
          let start = caret;
          let removed = 0;
          let inserted = 0;
          let applied = true;
          const op = rnd(10);
          if (op < 5 || op === 9) {
            const text = op < 5 ? alphabet[rnd(alphabet.length)] : alphabet[rnd(alphabet.length)] + alphabet[rnd(alphabet.length)];
            if (op === 9) applied = rnd(2) === 0;
            const kept = text.slice(0, Math.max(0, max - before.length));
            raw = before.slice(0, caret) + kept + before.slice(caret);
            inserted = kept.length;
            d.type(text, applied);
          } else if (op < 7) {
            if (caret > 0) {
              raw = before.slice(0, caret - 1) + before.slice(caret);
              start = caret - 1;
              removed = 1;
            }
            d.back();
          } else {
            d.move(rnd(d.s.native.length + 1));
          }
          if (d.s.native === d.s.shown) assert.equal(F.formatFieldValue(format, d.s.native), d.s.native);
          assert.ok(d.s.caret >= 0 && d.s.caret <= d.s.native.length);
          assert.ok(d.s.shown.length <= F.fieldFormatMaxLength(format));
          if (!applied || !synced || raw === before) continue;
          assert.equal(d.s.lastRaw, raw);
          const want = intended(format, before, raw, start, removed, inserted);
          assert.deepEqual({ value: d.s.native, caret: d.s.caret }, want, `${format.mask} ${JSON.stringify(before)} at ${caret} to ${JSON.stringify(raw)}`);
          checked += 1;
        }
      }
    }
    assert.ok(checked > 20000, String(checked));
  });
});

describe('field formats: one copy of the rules in the console and the app', () => {
  test('the app copy is the console copy', { skip: !existsSync(APP_COPY) }, () => {
    const lf = (file: string) => readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
    assert.equal(lf(APP_COPY), lf(ADMIN_COPY));
  });

  test('the module and this test carry no imports into the module and no prose comments', () => {
    const files = [ADMIN_COPY, TEST_FILE, ...(existsSync(APP_COPY) ? [APP_COPY] : [])];
    for (const file of files) assert.doesNotMatch(readFileSync(file, 'utf8'), /\/\*|(^|[^:])\/\/(?!\/)/m, file);
    assert.doesNotMatch(readFileSync(ADMIN_COPY, 'utf8'), /^\s*(import|export\s+\*|export\s+\{[^}]*\}\s+from)\b/m);
  });

  test('the sell screen uses the shared module and keeps the free-text cap the console names', { skip: !existsSync(APP_SCREEN) }, async () => {
    const rules = await loadAppModule<RulesModule>('(dashboard)/field-builder/rules.ts');
    const screen = readFileSync(APP_SCREEN, 'utf8');
    assert.match(screen, / from '\.\.\/\.\.\/lib\/fieldFormat';$/m);
    assert.match(screen, /input_format\?: string \| null; format_pattern\?: string \| null;/);
    assert.equal(screen.split('maxLength={200}').length - 1, 2);
    assert.match(rules.FORMAT_HINTS.free, /up to 200 characters/);
  });
});

describe('field formats: canonical SQL', () => {
  let sql = '';

  before(() => {
    if (existsSync(SCHEMA_FILE)) sql = readFileSync(SCHEMA_FILE, 'utf8').replace(/\r\n/g, '\n');
  });

  function body(name: string): string {
    const start = sql.indexOf(`CREATE OR REPLACE FUNCTION ${name}(`);
    assert.ok(start >= 0, name);
    return sql.slice(start, sql.indexOf('$$;', start));
  }

  test('both field tables get the columns and the checks the console and the app rely on', { skip: !existsSync(SCHEMA_FILE) }, () => {
    const kinds = F.INPUT_FORMATS.map((kind) => `'${kind}'`).join(', ');
    for (const table of ['card_type_template_fields', 'card_type_fields']) {
      const lines = [
        `ALTER TABLE ${table} ADD COLUMN IF NOT EXISTS input_format text;`,
        `ALTER TABLE ${table} ADD COLUMN IF NOT EXISTS format_pattern text;`,
        `ALTER TABLE ${table} DROP CONSTRAINT IF EXISTS ${table}_input_format_check;`,
        `ALTER TABLE ${table} ADD CONSTRAINT ${table}_input_format_check CHECK (input_format IS NULL OR (input_format IN (${kinds}) AND input_type IS NOT NULL AND input_type IN ('text', 'image_text')));`,
        `ALTER TABLE ${table} DROP CONSTRAINT IF EXISTS ${table}_format_pattern_check;`,
        `ALTER TABLE ${table} ADD CONSTRAINT ${table}_format_pattern_check CHECK ((input_format IS NOT DISTINCT FROM 'custom') = (format_pattern IS NOT NULL) AND (format_pattern IS NULL OR (char_length(format_pattern) <= ${F.PATTERN_MAX} AND format_pattern ~ '^[ -~]+$' AND format_pattern !~ '[0-9B-Za-z]' AND format_pattern !~ '^ ' AND format_pattern ~ '[#A*]$')));`,
      ];
      for (const line of lines) assert.equal(sql.split(`\n${line}\n`).length - 1, 1, line);
    }
  });

  test('the app catalog returns the format, and adding a card type to a country copies it', { skip: !existsSync(SCHEMA_FILE) }, () => {
    assert.ok(body('get_card_catalog').includes(
      '(SELECT f.id, f.label, f.input_type, f.input_format, f.format_pattern, f.is_required, f.sort_order, f.card_type_id',
    ));
    const add = body('admin_add_card_type_to_country');
    assert.ok(add.includes('INSERT INTO card_type_fields (card_type_id, label, input_type, input_format, format_pattern, is_required, sort_order)'));
    assert.ok(add.includes('SELECT v_id, f.label, f.input_type, f.input_format, f.format_pattern, coalesce(f.is_required, true),'));
  });
});
