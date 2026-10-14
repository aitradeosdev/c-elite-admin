import type { ConfirmOptions } from '../../_ui';
import { graceText } from '../../lib/adminSecurity';
import { formatAge, formatBusinessDateTime } from '../../lib/time';
import { REASON_MAX_LENGTH } from './rules';
import type { ReviewRow } from './model';
import { DiffValue } from './SettingsParts';
import { GRACE_DAYS, graceEndFrom, missingSummary, policyView, type PolicyState } from './securityPolicy';

export const EMERGENCY_ON_PHRASE = 'turn on emergency mode';
export const EMERGENCY_OFF_PHRASE = 'turn off emergency mode';

export const EMERGENCY_ON_REASONS: string[] = [
  'Payment provider outage',
  'Suspected fraud or security incident',
  'Planned maintenance',
];

export const EMERGENCY_OFF_REASONS: string[] = [
  'Incident resolved',
  'Maintenance finished',
  'Turned on by mistake',
];

export const EMERGENCY_ON_CONSEQUENCES: string[] = [
  'Every user sees a full-screen “Under Maintenance” notice and cannot use the app until it is turned off: no card trading, wallet, withdrawals, bill payments or in-app support.',
  'New withdrawal requests and bill payments (airtime, data, cable and electricity) are refused by the server straight away.',
  'Apps that are already open switch over the next time they reload settings, when opened or brought back to the screen. Allow a few minutes for cached settings to expire.',
  'Withdrawals already waiting for review are paused: none can be approved until emergency mode is turned off. Rejecting one still works and refunds the wallet.',
  'The admin app raises an “Emergency mode enabled” alert.',
];

export const EMERGENCY_OFF_CONSEQUENCES: string[] = [
  'The maintenance notice is lifted and users can use the app again.',
  'Withdrawals and bill payments are accepted again straight away, and withdrawals waiting for review can be approved again.',
  'Apps that are already open switch back the next time they reload settings, usually within a few minutes.',
];

export function emergencyOptions(turnOn: boolean, since: string | null, now: Date = new Date()): ConfirmOptions {
  const sinceText = since ? `${formatBusinessDateTime(since)} WAT (${formatAge(since, now)} ago)` : 'Not recorded';
  return {
    tone: 'danger',
    title: turnOn ? 'Turn on emergency mode?' : 'Turn off emergency mode?',
    message: turnOn
      ? 'This is the platform-wide kill switch. Use it during an incident, when users must be stopped from moving money.'
      : 'This reopens the platform for every user as soon as you confirm. Make sure the incident is resolved first.',
    details: [
      {
        label: 'Emergency mode',
        value: <DiffValue from={turnOn ? 'Off' : 'On'} to={turnOn ? 'On' : 'Off'} />,
        emphasis: true,
      },
      { label: turnOn ? 'Off since' : 'On since', value: sinceText },
    ],
    consequences: turnOn ? EMERGENCY_ON_CONSEQUENCES : EMERGENCY_OFF_CONSEQUENCES,
    requireTyped: turnOn ? EMERGENCY_ON_PHRASE : EMERGENCY_OFF_PHRASE,
    reason: {
      required: true,
      label: turnOn ? 'Why are you turning it on?' : 'Why is it safe to turn it off?',
      presets: turnOn ? EMERGENCY_ON_REASONS : EMERGENCY_OFF_REASONS,
      placeholder: turnOn ? 'Describe the incident' : 'Describe how it was resolved',
      maxLength: REASON_MAX_LENGTH,
    },
    confirmLabel: turnOn ? 'Turn on emergency mode' : 'Turn off emergency mode',
    pendingLabel: turnOn ? 'Turning on emergency mode…' : 'Turning off emergency mode…',
  };
}

export interface ReviewInput {
  rows: ReviewRow[];
  consequences: string[];
  conflicts: string[];
  money: boolean;
}

export function reviewOptions({ rows, consequences, conflicts, money }: ReviewInput): ConfirmOptions {
  const count = rows.length;
  const notes = [...conflicts, ...consequences];
  return {
    tone: money ? 'financial' : 'danger',
    title: count === 1 ? 'Apply 1 change to Admin Settings?' : `Apply ${count} changes to Admin Settings?`,
    message: 'The new values take effect for every user as soon as you apply them, and the change is recorded in the audit log.',
    details: rows.map((row) => ({
      label: row.label,
      value: (
        <DiffValue
          from={row.from}
          to={row.to}
          mono={row.mono}
          fromMissing={row.fromMissing}
          toMissing={row.toMissing}
        />
      ),
    })),
    consequences: notes.length > 0 ? notes : undefined,
    reason: {
      label: 'Note for the audit log',
      placeholder: 'Optional: why are you making this change?',
      maxLength: REASON_MAX_LENGTH,
    },
    confirmLabel: count === 1 ? 'Apply change' : `Apply ${count} changes`,
    cancelLabel: 'Keep editing',
    pendingLabel: count === 1 ? 'Applying the change…' : `Applying ${count} changes…`,
  };
}

export function discardOptions(count: number): ConfirmOptions {
  return {
    title: count === 1 ? 'Discard 1 unsaved change?' : `Discard ${count} unsaved changes?`,
    message: 'The fields go back to their live values. Nothing has been applied, so nothing changes for users.',
    confirmLabel: 'Discard changes',
    cancelLabel: 'Keep editing',
  };
}

export function leaveOptions(count: number): ConfirmOptions {
  return {
    tone: 'danger',
    title: 'Leave without applying?',
    message: count === 1
      ? 'You have 1 unsaved change on this page. Leaving discards it.'
      : `You have ${count} unsaved changes on this page. Leaving discards them.`,
    confirmLabel: 'Discard and leave',
    cancelLabel: 'Keep editing',
  };
}

export const POLICY_ON_REASONS: string[] = ['Security policy', 'After a security incident', 'Audit or compliance'];

export const POLICY_OFF_REASONS: string[] = ['Turned on by mistake', 'Rollout paused'];

export function policyOnOptions(state: PolicyState, now: Date = new Date()): ConfirmOptions {
  const grace = graceText(graceEndFrom(now), now);
  const until = grace ? grace.dateTime : `${GRACE_DAYS} days from now`;
  const by = grace ? grace.date : `${GRACE_DAYS} days from now`;
  return {
    title: 'Require two-step sign-in for every admin?',
    message: 'Once the grace period ends, every admin signs in with their password and a 6-digit code from an authenticator app.',
    details: [
      {
        label: 'Two-step sign-in',
        value: <DiffValue from="Not required" to="Required for every admin" />,
        emphasis: true,
      },
      { label: 'Grace period', value: `${GRACE_DAYS} days, until ${until}` },
      { label: 'Admins without it', value: missingSummary(state.roster.missing) },
    ],
    consequences: [
      `Admins without it see a banner asking them to set it up by ${by}.`,
      'After that they must set it up when they sign in on the web console before they can use it. The mobile app cannot set it up.',
      'In the mobile app, admins with it type their password followed by the 6-digit code.',
      'Admins already signed in stay signed in until their session ends.',
      'Every admin gets an alert in the mobile app.',
    ],
    reason: {
      required: true,
      label: 'Why are you requiring it?',
      presets: POLICY_ON_REASONS,
      maxLength: REASON_MAX_LENGTH,
    },
    credential: { kind: 'otp' },
    confirmLabel: 'Require two-step sign-in',
    pendingLabel: 'Requiring two-step sign-in…',
  };
}

export function policyOffOptions(state: PolicyState, now: Date = new Date()): ConfirmOptions {
  const view = policyView(state, now);
  return {
    tone: 'danger',
    title: 'Stop requiring two-step sign-in?',
    message: 'Admins who use it keep it. Admins without it can sign in with just their password again.',
    details: [
      {
        label: 'Two-step sign-in',
        value: <DiffValue from={view.statusLabel} to="Not required" />,
        emphasis: true,
      },
    ],
    consequences: [
      'The banner and the setup step at sign-in stop.',
      'The other super administrators are alerted.',
    ],
    reason: {
      required: true,
      label: 'Why are you stopping it?',
      presets: POLICY_OFF_REASONS,
      maxLength: REASON_MAX_LENGTH,
    },
    credential: { kind: 'otp' },
    confirmLabel: 'Stop requiring it',
    pendingLabel: 'Stopping the requirement…',
  };
}
