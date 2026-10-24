import { Money, formatNaira, type ConfirmOptions } from '../../../_ui';
import { ACCOUNT_STATES, accountState, userHandle, userSummary, type ProfileData } from './model';

const REASON_MAX = 500;

function amountOf(value: number | string | null): number {
  const amount = Number(value ?? 0);
  return Number.isFinite(amount) ? amount : 0;
}

export function deleteOptions({ user }: Pick<ProfileData, 'user'>): ConfirmOptions {
  const email = user.email ?? '';
  const balance = amountOf(user.balance);
  const bonus = amountOf(user.bonus_balance);
  const frozen = accountState(user) === 'frozen';
  return {
    tone: 'danger',
    title: `Delete ${userHandle(user)}?`,
    message: 'This deletes the account for good, in the same way as when the user deletes it in the app.',
    details: [
      { label: 'User', value: userSummary(user) },
      { label: 'User ID', value: user.id, mono: true },
      { label: 'Status', value: ACCOUNT_STATES[accountState(user)].label },
      ...(frozen ? [{ label: 'Frozen because', value: user.freeze_reason || 'No reason was recorded' }] : []),
      { label: 'Wallet balance', value: <Money value={user.balance} emphasis="strong" />, emphasis: true },
      ...(bonus > 0 ? [{ label: 'Bonus balance', value: <Money value={bonus} /> }] : []),
    ],
    consequences: [
      'This cannot be undone.',
      'It only goes ahead if the wallet is at ₦0 and no gift card trade, withdrawal or bill payment is still in progress. Otherwise nothing changes.',
      ...(balance > 0 ? [`The wallet holds ${formatNaira(balance)}, so the deletion will be refused until the user withdraws or spends it.`] : []),
      ...(bonus > 0 ? [`The bonus balance of ${formatNaira(bonus)} is lost when the account is deleted.`] : []),
      'The name, username, phone number, country and email address are removed, and no one can sign in to this account again.',
      'Devices, sign-in history and saved bank accounts are deleted, and the support chats are removed from the chat service soon after. Trade, withdrawal and bill payment records are kept.',
      ...(frozen ? ['The account is frozen. If the deletion is refused, it stays frozen with the same reason.'] : []),
    ],
    reason: {
      required: true,
      label: 'Reason for deleting',
      placeholder: 'For example: deletion requested by email on 22 October. Leave out names and email addresses.',
      maxLength: REASON_MAX,
    },
    requireTyped: email,
    acknowledge: `I have checked that the deletion request came from ${email}, the email address on this account, and that the account holder confirmed it when we replied.`,
    confirmLabel: 'Delete account',
  };
}

export function finishOptions({ user }: Pick<ProfileData, 'user'>): ConfirmOptions {
  return {
    tone: 'danger',
    title: `Finish deleting ${userHandle(user)}?`,
    message: 'This account’s deletion did not finish. Its details are already removed, but its sign-in is still there.',
    details: [
      { label: 'User', value: userSummary(user) },
      { label: 'User ID', value: user.id, mono: true },
    ],
    consequences: [
      'This cannot be undone.',
      'The sign-in is deleted, and any card photos left in storage are removed.',
    ],
    reason: {
      required: true,
      label: 'Reason for finishing',
      placeholder: 'For example: the deletion in the app stopped before the sign-in was removed.',
      maxLength: REASON_MAX,
    },
    confirmLabel: 'Finish deletion',
  };
}
