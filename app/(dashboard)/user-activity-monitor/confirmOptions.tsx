import type { ConfirmDetail, ConfirmOptions } from '../../_ui';
import { BUSINESS_TZ_LABEL, formatBusinessDateTime } from '../../lib/time';
import { DEVICE_LIMIT, REASON_MAX } from './rules';
import {
  deviceLabel,
  openSessionSummary,
  openSessionsOf,
  openSessionsText,
  plural,
  seenText,
  shortName,
  userSummary,
  type LoadedDetail,
  type OpenSessionSummary,
  type SessionRow,
  type SettledTerminate,
  type UserDetail,
} from './model';
import s from './page.module.css';

export type ConfirmBase = Omit<ConfirmOptions<SettledTerminate>, 'action'>;

export const TERMINATE_REASONS = [
  'Suspected account takeover',
  'Lost or stolen device',
  'Requested by the user',
  'Security investigation',
];

export const TERMINATE_PENDING = 'Signing out every session…';

const LISTED_SESSIONS = 5;

function OpenSessionList({ open, summary }: { open: readonly SessionRow[]; summary: OpenSessionSummary }) {
  if (open.length === 0) return <>{openSessionsText(summary)}</>;
  const listed = open.slice(0, LISTED_SESSIONS);
  const more = Math.max(0, summary.total - listed.length);
  return (
    <div className={s.confirmSessions}>
      <span className={s.confirmTotal}>{openSessionsText(summary)}</span>
      <ul className={s.confirmList}>
        {listed.map((session) => (
          <li key={session.id}>
            {deviceLabel(session)}
            {session.created_at ? (
              <span className={s.confirmSince}>
                since {formatBusinessDateTime(session.created_at)} {BUSINESS_TZ_LABEL}
              </span>
            ) : null}
          </li>
        ))}
        {more > 0 ? <li>and {plural(more, 'older open session')}</li> : null}
      </ul>
    </div>
  );
}

function devicesOnRecord(detail: LoadedDetail): string {
  if (detail.partial.devices) return 'Could not be checked';
  const shown = detail.devices.length;
  if (shown >= DEVICE_LIMIT) return `${DEVICE_LIMIT} or more devices`;
  return shown === 0 ? 'None recorded' : plural(shown, 'device');
}

export function terminateConfirm(detail: LoadedDetail): ConfirmBase {
  const { user } = detail;
  const open = openSessionsOf(detail.sessions);
  const summary = openSessionSummary(detail);
  const noneOpen = summary.exact && summary.total === 0;
  const details: ConfirmDetail[] = [
    { label: 'User', value: userSummary(user) },
    { label: 'Email', value: user.email || '—' },
    {
      label: 'Last seen',
      value: user.is_online ? `Online · ${seenText(user.last_active_at)}` : seenText(user.last_active_at),
    },
    { label: 'Open sessions', value: <OpenSessionList open={open} summary={summary} /> },
    { label: 'Devices on record', value: devicesOnRecord(detail) },
  ];
  return {
    tone: 'danger',
    title: `Sign ${shortName(user)} out everywhere?`,
    message: noneOpen
      ? 'No session is recorded as open, but any device that still holds a sign-in for this account loses it.'
      : 'Revokes every sign-in this customer has in the CardElite app, on every device.',
    details,
    consequences: [
      'Each device is signed out when its current session token expires, and has to sign in again.',
      'Until that token expires the app keeps working on the device, so the account can still show as online here for a while.',
      'Every device is signed out together; single sessions cannot be picked.',
      ...(user.deleted_at ? ['This account is deleted, so this only closes sessions that are still recorded as open.'] : []),
      'The account, its balances and its settings do not change.',
    ],
    reason: {
      required: true,
      label: 'Reason for signing them out',
      presets: TERMINATE_REASONS,
      placeholder: 'For example: the user reported their phone stolen',
      maxLength: REASON_MAX,
    },
    confirmLabel: 'Sign out everywhere',
    pendingLabel: TERMINATE_PENDING,
  };
}

export function terminateSuccess(user: UserDetail, endedSessions: number | null): string {
  const name = shortName(user);
  if (endedSessions === null) return `${name} was signed out everywhere.`;
  if (endedSessions === 0) return `${name} was signed out everywhere. No session was open.`;
  return `${name} was signed out everywhere. ${plural(endedSessions, 'open session was', 'open sessions were')} ended.`;
}
