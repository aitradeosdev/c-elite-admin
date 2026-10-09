import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeSearch } from '../app/lib/sanitize.ts';

describe('sanitizeSearch', () => {
  test('keeps Yoruba and other accented names intact', () => {
    assert.equal(sanitizeSearch('Ọlá'), 'Ọlá');
    assert.equal(sanitizeSearch('Adéwálé Ògúnmọ́lá'), 'Adéwálé Ògúnmọ́lá');
    assert.equal(sanitizeSearch('Chiọma'), 'Chiọma');
  });

  test('normalises decomposed input so the same name matches either way', () => {
    assert.equal(sanitizeSearch('Olá'), 'Olá');
  });

  test('still keeps the characters searches rely on', () => {
    assert.equal(sanitizeSearch('john.doe+test@mail.com'), 'john.doe+test@mail.com');
    assert.equal(sanitizeSearch('ade_123-x'), 'ade_123-x');
  });

  test('strips every character that has meaning in a PostgREST filter', () => {
    for (const bad of [',', '(', ')', ':', '*', '%', '"', "'", String.fromCharCode(92), String.fromCharCode(10), ';', '&', '=', '[', ']', '{', '}']) {
      assert.equal(sanitizeSearch(`a${bad}b`), 'ab', `did not strip ${JSON.stringify(bad)}`);
    }
  });

  test('an injection attempt cannot add a second filter', () => {
    const out = sanitizeSearch('x%,email.ilike.*@*');
    assert.ok(!out.includes(','), 'comma survived');
    assert.ok(!out.includes('*'), 'wildcard survived');
  });

  test('collapses repeated dots, trims, and caps length', () => {
    assert.equal(sanitizeSearch('  a...b  '), 'a.b');
    assert.equal(sanitizeSearch('x'.repeat(100)).length, 64);
  });
});
