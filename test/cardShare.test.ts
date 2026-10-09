import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  SHARE_CHANNELS, buildCardShareText, isShareChannel, permissionForChannel, sharedFieldLabels, shareSubject,
  type ShareableSubmission,
} from '../app/lib/cardShare.ts';

const base: ShareableSubmission = {
  cardName: 'Apple',
  countryName: 'United States',
  countryCode: 'US',
  amountForeign: 100,
  submittedFields: { f1: 'XQ7R-9921', f2: '4831', f3: '' },
  fieldLabels: { f1: 'Card code', f2: 'PIN' },
};

describe('buildCardShareText — must match the format both apps used before', () => {
  test('card, country, value, then each non-empty field by label', () => {
    assert.equal(
      buildCardShareText(base),
      'Card: Apple\nCountry: United States\nValue: 100\nCard code: XQ7R-9921\nPIN: 4831',
    );
  });

  test('falls back to the country code, then to the raw field key', () => {
    const text = buildCardShareText({
      ...base, countryName: null, fieldLabels: {}, submittedFields: { f9: 'abc' },
    });
    assert.equal(text, 'Card: Apple\nCountry: US\nValue: 100\nf9: abc');
  });

  test('skips non-string and empty field values', () => {
    const text = buildCardShareText({
      ...base, submittedFields: { a: 'kept', b: 42 as unknown as string, c: '', d: null as unknown as string },
      fieldLabels: { a: 'A' },
    });
    assert.ok(text.endsWith('A: kept'));
    assert.ok(!text.includes('42'));
  });

  test('a submission with nothing shareable yields an empty string, not "undefined"', () => {
    assert.equal(
      buildCardShareText({
        cardName: null, countryName: null, countryCode: null, amountForeign: null,
        submittedFields: null, fieldLabels: {},
      }),
      '',
    );
  });
});

describe('audit metadata never contains the codes themselves', () => {
  test('sharedFieldLabels lists labels only', () => {
    const labels = sharedFieldLabels(base);
    assert.deepEqual(labels, ['Card code', 'PIN']);
    for (const l of labels) {
      assert.ok(!l.includes('XQ7R') && !l.includes('4831'), 'a field VALUE leaked into the audit metadata');
    }
  });
});

describe('channels and permissions', () => {
  test('every channel validates and nothing else does', () => {
    for (const c of SHARE_CHANNELS) assert.ok(isShareChannel(c));
    for (const bad of ['sms', '', 'WHATSAPP', null, undefined, 3]) assert.ok(!isShareChannel(bad));
  });

  test('download needs the download permission; everything else needs the share permission', () => {
    assert.equal(permissionForChannel('download'), 'sensitive_data.download');
    for (const c of SHARE_CHANNELS.filter((x) => x !== 'download')) {
      assert.equal(permissionForChannel(c), 'sensitive_data.share');
    }
  });

  test('subject matches the original email subject', () => {
    assert.equal(shareSubject('Apple'), 'Card Submission - Apple');
    assert.equal(shareSubject(null), 'Card Submission - ');
  });
});
