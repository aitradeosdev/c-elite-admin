import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { formatNaira } from '../app/_ui/money.ts';

describe('formatNaira', () => {
  test('two decimals, thousands separators', () => {
    assert.equal(formatNaira(250000), '₦250,000.00');
    assert.equal(formatNaira(1234.5), '₦1,234.50');
  });

  test('never shows fractions of a kobo', () => {
    assert.equal(formatNaira(18.51855), '₦18.52');
    assert.equal(formatNaira(0.125), '₦0.13');
    assert.equal(formatNaira(0.005), '₦0.01');
  });

  test('rounds a tiny negative to zero without a stray minus sign', () => {
    assert.equal(formatNaira(-0.0049), '₦0.00');
    assert.equal(formatNaira(-0), '₦0.00');
  });

  test('keeps genuine negatives', () => {
    assert.equal(formatNaira(-500), '₦-500.00');
  });

  test('accepts numeric strings as the database returns them', () => {
    assert.equal(formatNaira('418000'), '₦418,000.00');
    assert.equal(formatNaira('99.999'), '₦100.00');
  });

  test('null, undefined and empty keep the existing zero contract', () => {
    assert.equal(formatNaira(null), '₦0.00');
    assert.equal(formatNaira(undefined), '₦0.00');
    assert.equal(formatNaira(''), '₦0.00');
  });

  test('garbage renders as a dash instead of ₦NaN', () => {
    assert.equal(formatNaira('not a number'), '—');
    assert.equal(formatNaira(Number.POSITIVE_INFINITY), '—');
  });
});
