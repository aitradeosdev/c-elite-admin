import { Notice, type ConfirmDetail, type ConfirmOptions } from '../../_ui';
import { twoStepUnlockText } from '../../lib/http';
import { isLocalAddress, isLockActive, type DeviceSession } from '../../lib/adminSecurity';
import { formatAge, formatBusinessDate, formatBusinessDateTime } from '../../lib/time';
import { REASON_MAX, diffGrants, normalizeGrants, type GrantChange } from './rules';
import {
  RESERVED_ADDITIONAL,
  adminHandle,
  plural,
  policyRequirement,
  type AdminRow,
  type EditProposal,
  type EditorDraft,
  type RebaseResult,
  type RowActionKind,
  type SecurityPolicy,
} from './model';
import { Change, GrantDiff } from './GrantParts';
import s from './page.module.css';

export type ConfirmBase = Omit<ConfirmOptions, 'action'>;

const RESERVED: ReadonlySet<string> = new Set(RESERVED_ADDITIONAL);

function reservedNote(change: GrantChange | null): string[] {
  const count = change ? change.added.filter((key) => RESERVED.has(key)).length : 0;
  if (count === 0) return [];
  return [
    `${plural(count, 'granted permission is', 'granted permissions are')} not checked anywhere yet. ${
      count === 1 ? 'It takes' : 'They take'
    } effect on ${count === 1 ? 'its' : 'their'} own when the feature that uses ${count === 1 ? 'it' : 'them'} ships.`,
  ];
}

function lastSignIn(admin: AdminRow): string {
  if (!admin.last_login_at) return 'Never';
  return `${formatBusinessDateTime(admin.last_login_at)} WAT · ${formatAge(admin.last_login_at)} ago`;
}

function adminDetails(admin: AdminRow): ConfirmDetail[] {
  return [
    { label: 'Admin', value: adminHandle(admin) },
    { label: 'Role title', value: admin.role_title || '—' },
  ];
}

export function createConfirm(draft: EditorDraft): ConfirmBase {
  const handle = adminHandle({ username: draft.username });
  const change = diffGrants([], normalizeGrants(draft.grants));
  return {
    title: `Create ${handle}?`,
    message: <GrantDiff change={change} addedTitle="Access granted" />,
    details: [
      { label: 'Username', value: handle },
      { label: 'Email', value: draft.email.trim() },
      { label: 'Role title', value: draft.roleTitle.trim() },
      { label: 'Password', value: 'Set, not shown again' },
    ],
    consequences: [
      `${handle} can sign in straight away with this username, email and password.`,
      'Send the password through a secure channel. It cannot be read back once the account exists.',
      ...reservedNote(change),
    ],
    reason: {
      required: true,
      label: 'Reason for the new account',
      placeholder: 'For example: new card reviewer for the night shift',
      maxLength: REASON_MAX,
    },
    confirmLabel: 'Create account',
  };
}

export function editConfirm(live: AdminRow, proposal: EditProposal, rebased: RebaseResult): ConfirmBase {
  const handle = adminHandle(live);
  const details: ConfirmDetail[] = [{ label: 'Admin', value: handle }];
  if (proposal.roleTitle) {
    details.push({ label: 'Role title', value: <Change before={proposal.roleTitle.before} after={proposal.roleTitle.after} /> });
  }
  if (proposal.email) {
    details.push({ label: 'Email', value: <Change before={proposal.email.before} after={proposal.email.after} /> });
  }
  if (proposal.password) details.push({ label: 'Password', value: 'Replaced with the new password' });
  if (proposal.grants) {
    details.push({
      label: 'Stored grants',
      value: <Change before={String(live.page_permissions.length)} after={String(proposal.nextGrants.length)} />,
    });
  }

  const conflictText = rebased.conflicts.map((field) => (field === 'email' ? 'email' : 'role title'));
  return {
    title: `Save changes to ${handle}?`,
    message: (
      <div className={s.confirmBody}>
        {rebased.changedElsewhere ? (
          <Notice tone="warning" compact flush title="Changed while you were editing">
            Another admin changed this account. Their changes are kept and yours are applied on top
            {conflictText.length ? `; you both changed the ${conflictText.join(' and ')}, and yours wins` : ''}.
          </Notice>
        ) : null}
        {proposal.grants ? (
          <GrantDiff change={proposal.grants} />
        ) : (
          <p className={s.confirmLead}>Access does not change.</p>
        )}
      </div>
    ),
    details,
    consequences: [
      ...(proposal.revokesSessions
        ? [`${handle} is signed out on every device, web and mobile, and must sign in again.`]
        : []),
      ...(proposal.email ? [`${handle} signs in with the new email from now on, and security alerts go there.`] : []),
      ...(live.is_active ? [] : [`${handle} is deactivated. These changes apply if the account is reactivated.`]),
      ...reservedNote(proposal.grants),
    ],
    reason: {
      required: true,
      label: 'Reason for the change',
      placeholder: 'Why are these changes needed?',
      maxLength: REASON_MAX,
    },
    confirmLabel: 'Save changes',
  };
}

const REVOKE_REASONS = [
  'Lost or stolen device',
  'Suspected account compromise',
  'Password shared or leaked',
  'Routine security rotation',
];

const DEACTIVATE_REASONS = ['Left the company', 'Role changed', 'Security concern', 'Temporary suspension'];

const REACTIVATE_REASONS = ['Returned to the team', 'Deactivated by mistake', 'Investigation closed'];

const DELETE_REASONS = ['Left the company', 'Duplicate account', 'No longer needed'];

export const ROW_ACTION_PENDING: Readonly<Record<RowActionKind, string>> = {
  revoke: 'Signing out every session…',
  deactivate: 'Deactivating the account…',
  reactivate: 'Reactivating the account…',
  remove: 'Deleting the account…',
};

export function rowActionSuccess(kind: RowActionKind, admin: AdminRow): string {
  const handle = adminHandle(admin);
  switch (kind) {
    case 'revoke':
      return `${handle} was signed out everywhere.`;
    case 'deactivate':
      return `${handle} was deactivated and signed out everywhere.`;
    case 'reactivate':
      return `${handle} was reactivated.`;
    case 'remove':
      return `${handle} was deleted.`;
  }
}

function accessMessage(admin: AdminRow, restoring: boolean) {
  if (admin.is_super_admin) {
    return (
      <p className={s.confirmLead}>
        {restoring ? 'Restores full super administrator access.' : 'Suspends full super administrator access.'}
      </p>
    );
  }
  const change = restoring ? diffGrants([], admin.page_permissions) : diffGrants(admin.page_permissions, []);
  return <GrantDiff change={change} addedTitle="Access restored" removedTitle="Access suspended" />;
}

export function rowActionConfirm(kind: RowActionKind, admin: AdminRow): ConfirmBase {
  const handle = adminHandle(admin);
  switch (kind) {
    case 'revoke':
      return {
        tone: 'danger',
        title: `Sign ${handle} out everywhere?`,
        message: 'Ends every session this admin has, on the web console and in the mobile app.',
        details: [
          ...adminDetails(admin),
          { label: 'Access', value: admin.is_super_admin ? 'Unchanged, full access' : `Unchanged, ${plural(admin.page_permissions.length, 'grant')}` },
          { label: 'Last sign-in', value: lastSignIn(admin) },
        ],
        consequences: [
          'They can sign in again straight away.',
          'To end one device only, use the Security tab in their account.',
        ],
        reason: { required: true, label: 'Reason for signing them out', presets: REVOKE_REASONS, maxLength: REASON_MAX },
        confirmLabel: 'Sign out everywhere',
      };
    case 'deactivate':
      return {
        tone: 'danger',
        title: `Deactivate ${handle}?`,
        message: accessMessage(admin, false),
        details: [
          ...adminDetails(admin),
          { label: 'Status', value: <Change before="Active" after="Inactive" /> },
          ...(admin.is_super_admin ? [{ label: 'Super admin', value: 'Yes' }] : []),
        ],
        consequences: [
          `${handle} is signed out everywhere and cannot sign in until the account is reactivated.`,
          'Admin alerts and push notifications stop for this account.',
          'Grants are kept and come back if the account is reactivated.',
          ...(admin.is_super_admin ? ['The last active super admin cannot be deactivated.'] : []),
        ],
        reason: { required: true, label: 'Reason for deactivating', presets: DEACTIVATE_REASONS, maxLength: REASON_MAX },
        confirmLabel: 'Deactivate',
      };
    case 'reactivate':
      return {
        title: `Reactivate ${handle}?`,
        message: accessMessage(admin, true),
        details: [
          ...adminDetails(admin),
          { label: 'Status', value: <Change before="Inactive" after="Active" /> },
          { label: 'Email', value: admin.email || 'None' },
        ],
        consequences: [
          `${handle} can sign in again with their existing email and password.`,
          'Sessions from before the deactivation stay signed out.',
          ...(admin.email ? [] : ['This account has no email, so it cannot sign in until one is added.']),
        ],
        reason: { required: true, label: 'Reason for reactivating', presets: REACTIVATE_REASONS, maxLength: REASON_MAX },
        confirmLabel: 'Reactivate',
      };
    case 'remove':
      return {
        tone: 'danger',
        title: `Delete ${handle}?`,
        message: (
          <div className={s.confirmBody}>
            <p className={s.confirmLead}>
              The account is removed for good. It can never sign in or be reactivated, and the username stays taken.
            </p>
            {admin.page_permissions.length ? (
              <GrantDiff change={diffGrants(admin.page_permissions, [])} removedTitle="Grants removed for good" showEffect={false} />
            ) : null}
          </div>
        ),
        details: [
          ...adminDetails(admin),
          { label: 'Status', value: <Change before="Inactive" after="Deleted" /> },
          { label: 'Last sign-in', value: lastSignIn(admin) },
        ],
        consequences: ['This cannot be undone.', 'The account’s audit history is kept.'],
        reason: { required: true, label: 'Reason for deleting', presets: DELETE_REASONS, maxLength: REASON_MAX },
        requireTyped: admin.username.trim() || 'DELETE',
        confirmLabel: 'Delete account',
      };
  }
}

export const RESET_REASONS = [
  'Lost or replaced phone',
  'Authenticator app removed',
  'Locked out after too many codes',
  'Suspected account compromise',
];

export const RESET_PENDING = 'Resetting two-step sign-in…';

export const DEVICE_SIGN_OUT_PENDING = 'Signing out the device…';

export const APP_SESSION_NOTE = 'The app goes back to its sign-in screen the next time it reaches the server.';

function twoStepBefore(admin: AdminRow, now: Date): string {
  const security = admin.security;
  if (security && isLockActive(security.lockedUntil, now)) {
    const until = twoStepUnlockText(security.lockedUntil, now.getTime());
    return until ? `Locked until ${until}` : 'Locked';
  }
  return security?.confirmedAt ? `On since ${formatBusinessDate(security.confirmedAt)}` : 'On';
}

function setUpAgainText(policy: SecurityPolicy, now: Date): string {
  const requirement = policyRequirement(policy, now);
  if (requirement.kind === 'required') return 'They must set it up again the next time they sign in.';
  if (requirement.kind === 'grace') {
    return `They are asked to set it up again by ${requirement.date}, and must set it up when they sign in after that.`;
  }
  return 'They can set it up again on their Profile.';
}

export function resetMfaConfirm(admin: AdminRow, policy: SecurityPolicy, now: Date = new Date()): ConfirmBase {
  const handle = adminHandle(admin);
  return {
    tone: 'danger',
    title: `Reset two-step sign-in for ${handle}?`,
    message: 'Use this when they lost their phone or authenticator app. Their password does not change.',
    details: [
      ...adminDetails(admin),
      { label: 'Two-step sign-in', value: <Change before={twoStepBefore(admin, now)} after="Off" /> },
      { label: 'Recovery codes left', value: String(admin.security?.recoveryCodesLeft ?? 0) },
    ],
    consequences: [
      'Their authenticator app and recovery codes stop working straight away.',
      'They are signed out everywhere, on the web and in the mobile app.',
      setUpAgainText(policy, now),
      `Super administrators get an alert, and ${handle} sees the reset on their Profile.`,
    ],
    reason: { required: true, label: 'Reason for the reset', presets: RESET_REASONS, maxLength: REASON_MAX },
    credential: { kind: 'otp' },
    confirmLabel: 'Reset two-step sign-in',
    pendingLabel: RESET_PENDING,
  };
}

export function resetSuccess(admin: AdminRow): string {
  return `${adminHandle(admin)}’s two-step sign-in was reset and they were signed out everywhere.`;
}

function addressText(ip: string | null): string {
  if (!ip) return 'Not recorded';
  return isLocalAddress(ip) ? `Local address (${ip})` : ip;
}

function seenText(at: string | null, now: Date): string {
  if (!at) return 'Not recorded';
  return `${formatBusinessDateTime(at)} WAT · ${formatAge(at, now)} ago`;
}

export function deviceSignOutConfirm(
  admin: AdminRow,
  session: DeviceSession,
  device: string,
  now: Date = new Date(),
): ConfirmBase {
  const handle = adminHandle(admin);
  return {
    tone: 'danger',
    title: `Sign out ${handle} on ${device}?`,
    message: 'That session ends straight away. Their other devices stay signed in.',
    details: [
      { label: 'Admin', value: handle },
      { label: 'Device', value: device },
      { label: 'Signed in', value: session.createdAt ? `${formatBusinessDateTime(session.createdAt)} WAT` : 'Not recorded' },
      { label: 'Last active', value: seenText(session.lastSeenAt, now) },
      { label: 'IP', value: addressText(session.ip), mono: true },
    ],
    consequences: session.client === 'mobile' ? [APP_SESSION_NOTE] : undefined,
    reason: { required: true, label: 'Reason for signing out this device', presets: REVOKE_REASONS, maxLength: REASON_MAX },
    confirmLabel: 'Sign out',
    pendingLabel: DEVICE_SIGN_OUT_PENDING,
  };
}

export function deviceSignOutSuccess(admin: AdminRow, device: string): string {
  return `${adminHandle(admin)} was signed out of ${device}.`;
}
