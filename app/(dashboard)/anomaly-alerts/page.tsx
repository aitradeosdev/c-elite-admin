'use client';

import { ConfigForm, validateTimeZone, type ConfigSection } from '../_config/ConfigForm';

const SECTIONS: ConfigSection[] = [
  {
    title: 'Dormant Account Activity',
    fields: [
      {
        key: 'anomaly_dormant_days',
        label: 'Dormant Days',
        hint: 'Number of days of inactivity that makes a sudden large withdrawal suspicious.',
        input: 'number',
        min: 0,
        step: 1,
      },
      {
        key: 'anomaly_dormant_amount',
        label: 'Dormant Amount Threshold (₦)',
        hint: 'A withdrawal of at least this amount on a previously dormant account is flagged.',
        input: 'number',
        min: 0,
        step: 1,
      },
    ],
  },
  {
    title: 'Rapid Withdrawal Pattern',
    fields: [
      {
        key: 'anomaly_rapid_window_mins',
        label: 'Window (minutes)',
        hint: 'Time window to look back when checking a withdrawal against deposits.',
        input: 'number',
        min: 0,
        step: 1,
      },
      {
        key: 'anomaly_rapid_ratio',
        label: 'Ratio (0–1)',
        hint: 'Flag when withdrawn / deposited within the window exceeds this ratio. Example: 0.80 = 80%.',
        input: 'number',
        min: 0,
        max: 1,
        step: 0.01,
      },
    ],
  },
  {
    title: 'Failed Transaction Burst',
    fields: [
      {
        key: 'anomaly_failures_window_mins',
        label: 'Window (minutes)',
        hint: 'Look-back window for counting failed transactions.',
        input: 'number',
        min: 0,
        step: 1,
      },
      {
        key: 'anomaly_failures_threshold',
        label: 'Failures Threshold',
        hint: 'Number of failures within the window before the user is flagged.',
        input: 'number',
        min: 0,
        step: 1,
      },
    ],
  },
  {
    title: 'Critical Alerts',
    fields: [
      {
        key: 'alert_critical_amount',
        label: 'Critical Amount (₦)',
        hint: 'Single-transaction amount that triggers a high-severity admin alert.',
        input: 'number',
        min: 0,
        step: 1,
      },
      {
        key: 'security_alerts_batch_size',
        label: 'Email Batch Size',
        hint: 'Max security alert emails sent per cron run.',
        input: 'number',
        min: 1,
        max: 500,
        step: 1,
      },
      {
        key: 'alert_timezone',
        label: 'Alert Email Timezone',
        hint: 'IANA timezone (e.g. Africa/Lagos) used only for timestamps shown in security alert emails. Does not affect anomaly detection or withdrawal limits.',
        input: 'text',
        mono: true,
        required: true,
        validate: validateTimeZone,
      },
    ],
  },
];

export default function AnomalyAlertsPage() {
  return (
    <ConfigForm
      title="Anomaly & Alerts"
      subtitle="Tune the thresholds that drive fraud detection and critical security alert emails."
      endpoint="/api/anomaly-alerts"
      sections={SECTIONS}
    />
  );
}
