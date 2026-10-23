'use client';

import { ConfigForm, validateNumberList, type ConfigSection } from '../../_config/ConfigForm';

const quickAmounts = (value: string) => validateNumberList(value, { min: 1, integer: true });

const SECTIONS: ConfigSection[] = [
  {
    title: 'Airtime',
    fields: [
      {
        key: 'airtime_quick_amounts',
        label: 'Quick Amounts (CSV)',
        hint: 'Comma-separated buttons shown on the Airtime screen. Example: 100,200,500,1000',
        input: 'text',
        mono: true,
        required: true,
        validate: quickAmounts,
      },
      {
        key: 'min_airtime_amount',
        label: 'Minimum Amount (₦)',
        hint: 'Smallest airtime purchase a user can make.',
        input: 'number',
        min: 0,
        step: 1,
      },
    ],
  },
  {
    title: 'Electricity',
    fields: [
      {
        key: 'electricity_quick_amounts',
        label: 'Quick Amounts (CSV)',
        hint: 'Comma-separated buttons shown on the Electricity screen. Example: 1000,2000,5000,10000',
        input: 'text',
        mono: true,
        required: true,
        validate: quickAmounts,
      },
      {
        key: 'min_electricity_amount',
        label: 'Minimum Amount (₦)',
        hint: 'Smallest electricity purchase a user can make.',
        input: 'number',
        min: 0,
        step: 1,
      },
    ],
  },
];

export default function BillSettingsPage() {
  return (
    <ConfigForm
      title="Bill Settings"
      subtitle="Configure the quick-amount presets and minimum purchase limits for airtime and electricity bills."
      endpoint="/api/bill-settings"
      sections={SECTIONS}
    />
  );
}
