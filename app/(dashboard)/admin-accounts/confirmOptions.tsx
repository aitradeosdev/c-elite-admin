import { Notice, type ConfirmDetail, type ConfirmOptions } from '../../_ui';
import { twoStepUnlockText } from '../../lib/http';
import { isLocalAddress, isLockActive, type DeviceSession } from '../../lib/adminSecurity';
import { formatAge, formatBusinessDate, formatBusinessDateTime } from '../../lib/time';
import { REASON_MAX, diffGrants, sameGrants } from './rules';
import {
  NO_ROLE_LABEL,
  SUPER_ADMIN_ROLE_LABEL,
  adminHandle,
  plural,
  policyRequirement,
  roleLabel,
  type AccessPreview,
  type AccessResult,
  type AdminRow,
  type EditProposal,
  type EditorDraft,
  type RebaseResult,
  type RowActionKind,
  type SecurityPolicy,
  type SuperAdminChange,
  type SuperAdminResult,
} from './model';
import { Change, GrantDiff } from '../_access';
import s from './page.module.css';

export type ConfirmBase = Omit<ConfirmOptions, 'action'>;

export interface AccessSide {
  roleName: string | null;
  direct: readonly string[];
}

const CREATE_WITHOUT_ACCESS =
  'The account is created without access. Give it a role or additional access afterwards in its Access section.';

const CREATE_THEN_ACCESS =
  'The account is created without access first. Its access is then saved as a second change, which you review and confirm with its own reason.';

const ACCESS_SAVED_SEPARATELY =
  'Access does not change in this save. Your access changes are saved separately with Review access.';

function lastSignIn(admin: AdminRow): string {
  if (!admin.last_login_at) return 'Never';
  return `${formatBusinessDateTime(admin.last_login_at)} WAT · ${formatAge(admin.last_login_at)} ago`;
}

function adminDetails(admin: AdminRow): ConfirmDetail[] {
  return [
    { label: 'Admin', value: adminHandle(admin) },
    { label: 'Title', value: admin.role_title || '—' },
  ];
}

function grantCount(keys: readonly string[]): string {
  return keys.length ? plural(keys.length, 'grant') : 'None';
}

export function createConfirm(draft: EditorDraft, access: AccessSide | null): ConfirmBase {
  const handle = adminHandle({ username: draft.username });
  const details: ConfirmDetail[] = [
    { label: 'Username', value: handle },
    { label: 'Email', value: draft.email.trim() },
    { label: 'Title', value: draft.roleTitle.trim() },
    { label: 'Password', value: 'Set, not shown again' },
  ];
  if (access) {
    details.push({ label: 'Role', value: access.roleName ?? NO_ROLE_LABEL });
    if (access.direct.length) details.push({ label: 'Additional access', value: grantCount(access.direct) });
  }
  return {
    title: `Create ${handle}?`,
    message: <p className={s.confirmLead}>{access ? CREATE_THEN_ACCESS : CREATE_WITHOUT_ACCESS}</p>,
    details,
    consequences: [
      `${handle} can sign in straight away with this username, email and password.`,
      'Send the password through a secure channel. It cannot be read back once the account exists.',
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

export function editConfirm(
  live: AdminRow,
  proposal: EditProposal,
  rebased: RebaseResult,
  accessPending = false,
): ConfirmBase {
  const handle = adminHandle(live);
  const details: ConfirmDetail[] = [{ label: 'Admin', value: handle }];
  if (proposal.roleTitle) {
    details.push({ label: 'Title', value: <Change before={proposal.roleTitle.before} after={proposal.roleTitle.after} /> });
  }
  if (proposal.email) {
    details.push({ label: 'Email', value: <Change before={proposal.email.before} after={proposal.email.after} /> });
  }
  if (proposal.password) details.push({ label: 'Password', value: 'Replaced with the new password' });

  const conflictText = rebased.conflicts.map((field) => (field === 'email' ? 'email' : 'title'));
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
        <p className={s.confirmLead}>{accessPending ? ACCESS_SAVED_SEPARATELY : 'Access does not change.'}</p>
      </div>
    ),
    details,
    consequences: [
      ...(proposal.revokesSessions
        ? [`${handle} is signed out on every device, web and mobile, and must sign in again.`]
        : []),
      ...(proposal.email ? [`${handle} signs in with the new email from now on, and security alerts go there.`] : []),
      ...(live.is_active ? [] : [`${handle} is deactivated. These changes apply if the account is reactivated.`]),
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

export interface AccessConfirmInput {
  admin: AdminRow;
  preview: AccessPreview;
  before: AccessSide;
  after: AccessSide;
  titlePending?: boolean;
}

export const ACCESS_PENDING = 'Saving the access change…';

export function accessConfirm({ admin, preview, before, after, titlePending = false }: AccessConfirmInput): ConfirmBase {
  const handle = adminHandle(admin);
  const roleBefore = before.roleName ?? NO_ROLE_LABEL;
  const roleAfter = after.roleName ?? NO_ROLE_LABEL;
  const details: ConfirmDetail[] = [
    { label: 'Admin', value: handle },
    { label: 'Role', value: roleBefore === roleAfter ? roleAfter : <Change before={roleBefore} after={roleAfter} /> },
  ];
  if (!sameGrants(before.direct, after.direct)) {
    details.push({
      label: 'Additional access',
      value: <Change before={grantCount(before.direct)} after={grantCount(after.direct)} />,
    });
  }
  const staysSignedIn = !preview.changed && admin.is_active && !titlePending;
  return {
    title: `Change access for ${handle}?`,
    message: (
      <div className={s.confirmBody}>
        {preview.changed ? (
          <GrantDiff change={{ added: [], removed: [], gained: preview.gained, lost: preview.lost }} />
        ) : (
          <p className={s.confirmLead}>{staysSignedIn ? `Access unchanged. ${handle} stays signed in.` : 'Access unchanged.'}</p>
        )}
        {preview.folded.length ? (
          <p className={s.confirmLead}>Moved into the role: {preview.folded.join(', ')}</p>
        ) : null}
      </div>
    ),
    details,
    consequences: [
      ...(preview.signsOut ? [`${handle} is signed out on every device, web and mobile, and must sign in again.`] : []),
      ...(preview.changed && !admin.is_active
        ? [`${handle} is deactivated. These changes apply if the account is reactivated.`]
        : []),
      ...(titlePending
        ? [`The new title is saved separately with Review changes, and saving it signs ${handle} out on every device.`]
        : []),
    ],
    reason: {
      required: true,
      label: 'Reason for the access change',
      placeholder: 'Why does this admin need this access?',
      maxLength: REASON_MAX,
    },
    confirmLabel: 'Save access',
    pendingLabel: ACCESS_PENDING,
  };
}

export function accessIdentityConfirm(admin: AdminRow): ConfirmBase {
  return {
    title: 'Confirm it is you',
    message: `Access changes need a recent identity check. Enter a code from your authenticator app to save the change for ${adminHandle(admin)}.`,
    credential: { kind: 'otp' },
    confirmLabel: 'Save access',
    pendingLabel: ACCESS_PENDING,
  };
}

export function accessSavedText(admin: AdminRow, result: AccessResult): string {
  const handle = adminHandle(admin);
  if (!result.changed) return 'Nothing changed. This access was already live.';
  if (result.signedOut) return `Saved access for ${handle}. They were signed out everywhere and must sign in again.`;
  return admin.is_active ? `Saved access for ${handle}. They stay signed in.` : `Saved access for ${handle}.`;
}

export const SUPER_ADMIN_PENDING = 'Saving the super admin change…';

export function superAdminConfirm(admin: AdminRow, change: SuperAdminChange): ConfirmBase {
  const handle = adminHandle(admin);
  const signOut = admin.is_active
    ? `${handle} is signed out on every device, web and mobile, and must sign in again.`
    : `${handle} is deactivated, so they are already signed out.`;
  if (change === 'make') {
    return {
      tone: 'danger',
      title: `Make ${handle} a super admin?`,
      message: (
        <p className={s.confirmLead}>
          Super administrators hold every permission, including managing admins, roles and other super administrators.
        </p>
      ),
      details: [
        { label: 'Admin', value: handle },
        { label: 'Role', value: <Change before={roleLabel(admin)} after={SUPER_ADMIN_ROLE_LABEL} /> },
      ],
      consequences: [
        `${handle} gets full access to every page and action.`,
        ...(admin.role_id ? [`Their role ${roleLabel(admin)} is cleared, because roles do not apply to super admins.`] : []),
        signOut,
        'Every super administrator gets an alert.',
      ],
      reason: {
        required: true,
        label: 'Reason for making them a super admin',
        placeholder: 'Why does this admin need full access?',
        maxLength: REASON_MAX,
      },
      confirmLabel: 'Make super admin',
      pendingLabel: SUPER_ADMIN_PENDING,
    };
  }
  return {
    tone: 'danger',
    title: `Remove super admin from ${handle}?`,
    message: (
      <p className={s.confirmLead}>
        They lose every permission. Give them a role in their Access section afterwards for the access they need.
      </p>
    ),
    details: [
      { label: 'Admin', value: handle },
      { label: 'Role', value: <Change before={SUPER_ADMIN_ROLE_LABEL} after={NO_ROLE_LABEL} /> },
    ],
    consequences: [
      `${handle} has no access until a role is given.`,
      signOut,
      'Every super administrator gets an alert.',
    ],
    reason: {
      required: true,
      label: 'Reason for removing super admin',
      placeholder: 'Why should this admin stop being a super admin?',
      maxLength: REASON_MAX,
    },
    confirmLabel: 'Remove super admin',
    pendingLabel: SUPER_ADMIN_PENDING,
  };
}

export function superAdminIdentityConfirm(admin: AdminRow, change: SuperAdminChange): ConfirmBase {
  const handle = adminHandle(admin);
  const goal = change === 'make' ? `make ${handle} a super admin` : `remove super admin from ${handle}`;
  return {
    title: 'Confirm it is you',
    message: `Super admin changes need a recent identity check. Enter a code from your authenticator app to ${goal}.`,
    credential: { kind: 'otp' },
    confirmLabel: change === 'make' ? 'Make super admin' : 'Remove super admin',
    pendingLabel: SUPER_ADMIN_PENDING,
  };
}

export function superAdminSavedText(admin: AdminRow, change: SuperAdminChange, result: SuperAdminResult): string {
  const handle = adminHandle(admin);
  const signedOut = result.signedOut && admin.is_active ? ' They were signed out everywhere and must sign in again.' : '';
  return change === 'make'
    ? `${handle} is now a super admin.${signedOut}`
    : `${handle} is no longer a super admin and has no access until a role is given.${signedOut}`;
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
