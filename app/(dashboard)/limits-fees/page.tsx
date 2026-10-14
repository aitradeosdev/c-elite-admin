'use client';

import { ConfigForm, notAbove, notBelow, type ConfigSection, type ConfigValidator } from '../_config/ConfigForm';

const WHOLE_NAIRA = /^[1-9]\d*$/;

function wholeNaira(next: ConfigValidator): ConfigValidator {
  return (value, values) => (
    WHOLE_NAIRA.test(value.trim()) ? next(value, values) : 'Enter whole naira, without decimals or leading zeros.'
  );
}

const SECTIONS: ConfigSection[] = [
  {
    title: 'Withdrawals',
    fields: [
      {
        key: 'min_withdrawal_amount',
        label: 'Minimum Withdrawal (₦)',
        hint: 'Smallest amount a user can withdraw per request.',
        input: 'number',
        min: 1,
        max: 1_000_000_000,
        step: 1,
        validate: notAbove('max_withdrawal_amount', 'the maximum withdrawal'),
      },
      {
        key: 'max_withdrawal_amount',
        label: 'Maximum Withdrawal (₦)',
        hint: 'Largest amount a user can withdraw in a single request.',
        input: 'number',
        min: 1,
        max: 1_000_000_000,
        step: 1,
        validate: notBelow('min_withdrawal_amount', 'the minimum withdrawal'),
      },
      {
        key: 'max_daily_withdrawal',
        label: 'Daily Withdrawal Cap (₦)',
        hint: 'Total per-user per-day limit across all withdrawals.',
        input: 'number',
        min: 1,
        max: 10_000_000_000,
        step: 1,
      },
      {
        key: 'pin_reset_freeze_hours',
        label: 'PIN-Reset Withdrawal Freeze (hours)',
        hint: 'After a user resets their PIN via OTP, withdrawals are blocked for this many hours. Set 0 to disable. Max 720 (30 days).',
        input: 'number',
        min: 0,
        max: 720,
        step: 1,
        consequence: (next) => (Number(next) === 0 ? 'Withdrawals will no longer be paused after a PIN reset.' : null),
      },
      {
        key: 'withdraw_fee',
        label: 'Withdraw Fee (₦)',
        hint: 'Flat fee charged on withdrawals to bank accounts. Set 0 for free.',
        input: 'number',
        min: 0,
        max: 100_000,
        step: 1,
        consequence: (next) => (Number(next) === 0 ? 'Withdrawals to bank accounts will be free of charge.' : null),
      },
    ],
  },
  {
    title: 'Wallet Adjustments',
    description: 'Every admin, including super admins, stays within these limits when crediting or debiting a user wallet.',
    fields: [
      {
        key: 'max_wallet_adjustment_naira',
        label: 'Per-Adjustment Limit (₦)',
        hint: 'Largest credit or debit an admin can make in one wallet adjustment. Whole naira only.',
        input: 'number',
        min: 1,
        max: 10_000_000_000,
        step: 1,
        validate: wholeNaira(notAbove('max_wallet_adjustment_daily_naira', 'the daily adjustment limit')),
      },
      {
        key: 'max_wallet_adjustment_daily_naira',
        label: 'Daily Adjustment Limit per Admin (₦)',
        hint: 'Total of all credits and debits one admin can make in a day (WAT). Whole naira only.',
        input: 'number',
        min: 1,
        max: 10_000_000_000,
        step: 1,
        validate: wholeNaira(notBelow('max_wallet_adjustment_naira', 'the per-adjustment limit')),
      },
    ],
  },
  {
    title: 'Anomaly Detection',
    fields: [
      {
        key: 'large_withdrawal_flag_threshold',
        label: 'Large Withdrawal Flag (₦)',
        hint: 'Withdrawals >= this amount get auto-flagged for admin review in flagged_transactions. Set 0 to disable.',
        input: 'number',
        min: 0,
        max: 10_000_000_000,
        step: 1,
        consequence: (next) => (Number(next) === 0 ? 'Large withdrawals will no longer be flagged for admin review.' : null),
      },
    ],
  },
];

export default function LimitsFeesPage() {
  return (
    <ConfigForm
      title="Limits & Fees"
      subtitle="Set withdrawal limits, wallet adjustment limits and the auto-flag threshold that gate money movement across the app."
      endpoint="/api/limits-fees"
      sections={SECTIONS}
    />
  );
}
