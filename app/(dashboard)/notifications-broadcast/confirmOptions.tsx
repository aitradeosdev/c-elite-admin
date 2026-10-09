import type { ConfirmDetail, ConfirmOptions } from '../../_ui';
import {
  AUDIENCE_META, DUPLICATE_WINDOW_SECONDS, SEND_AGAIN_PHRASE, SEND_ALL_PHRASE, TYPE_LABELS, reachesEveryone,
  unknownVariables, usedVariables,
} from './broadcastRules';
import { plural, recipientsText, userSummary, type SendOutcome, type SendPlan } from './model';
import { NotificationPreview } from './BroadcastParts';
import s from './page.module.css';

const PENDING_LABEL = 'Sending. Large audiences can take up to a minute, so keep this page open.';

export function sendConsequences(plan: SendPlan): string[] {
  const lines: string[] = [];
  if (plan.audience === 'specific') {
    lines.push(
      plan.user && !plan.user.pushEnabled
        ? 'The user gets an in-app notification straight away. Push is turned off for them, so there is no push.'
        : 'The user gets an in-app notification straight away, and a push if they allow push.',
    );
  } else {
    lines.push('Every account in the audience gets an in-app notification straight away. Users who allow push also get a push.');
  }
  if (plan.audience === 'all_anon') lines.push('App-only devices get the push only.');
  lines.push('A sent broadcast cannot be recalled, edited or deleted.');
  const personal = usedVariables(plan.title, plan.message).filter((spec) => spec.scope === 'user');
  if (personal.length > 0) {
    const names = personal.map((spec) => `{${spec.token}}`).join(', ');
    lines.push(
      plan.audience === 'all_anon'
        ? `Personal variables (${names}) are filled in for each user and left blank on app-only devices.`
        : `Personal variables (${names}) are filled in separately for each user.`,
    );
  }
  const unknown = unknownVariables(plan.title, plan.message);
  if (unknown.length > 0) {
    const one = unknown.length === 1;
    lines.push(
      `${unknown.join(', ')} ${one ? 'is not a variable' : 'are not variables'} the broadcast service knows. Go back and fix ${one ? 'it' : 'them'} unless that text is intended.`,
    );
  }
  if (plan.user && !plan.user.active) lines.push('This account is marked inactive, so the user may not see this.');
  if (plan.allowDuplicate) {
    const minutes = Math.round(DUPLICATE_WINDOW_SECONDS / 60);
    lines.push(`An identical broadcast went to this audience less than ${minutes} minutes ago. Everyone who got it receives it again.`);
  }
  return lines;
}

export function sendOptions(plan: SendPlan): ConfirmOptions<SendOutcome> {
  const everyone = reachesEveryone(plan.audience);
  const meta = AUDIENCE_META[plan.audience];
  const personal = usedVariables(plan.title, plan.message).some((spec) => spec.scope === 'user');
  const details: ConfirmDetail[] = [
    {
      label: 'Audience',
      value: (
        <span className={s.confirmValue}>
          <span>{meta.label}</span>
          <span className={s.confirmHint}>{meta.description}</span>
        </span>
      ),
    },
    {
      label: 'Recipients',
      value: (
        <span className={s.confirmValue}>
          <span>{recipientsText(plan.audience, plan.recipients)}</span>
          {plan.audience === 'specific' ? null : <span className={s.confirmHint}>Counted just now</span>}
        </span>
      ),
      emphasis: true,
    },
  ];
  if (plan.audience === 'specific' && plan.user) {
    details.push({ label: 'User', value: userSummary(plan.user) });
    details.push({ label: 'Push', value: plan.user.pushEnabled ? 'On' : 'Off, in-app only' });
  }
  details.push({ label: 'Category', value: TYPE_LABELS[plan.type] });
  return {
    tone: everyone ? 'danger' : 'default',
    title: plan.allowDuplicate ? 'Send this broadcast again?' : meta.question,
    message: (
      <div className={s.confirmBody}>
        <p className={s.confirmLead}>
          {personal
            ? 'Delivery starts as soon as you confirm. Users see this, with personal variables filled in for each of them:'
            : 'Delivery starts as soon as you confirm. Users see exactly this:'}
        </p>
        <NotificationPreview title={plan.title} message={plan.message} globals={plan.globals} />
      </div>
    ),
    details,
    consequences: sendConsequences(plan),
    confirmLabel: plan.audience === 'specific'
      ? 'Send to this user'
      : `Send to ${plural(plan.recipients.total, 'recipient', 'recipients')}`,
    cancelLabel: 'Keep editing',
    requireTyped: everyone ? SEND_ALL_PHRASE : plan.allowDuplicate ? SEND_AGAIN_PHRASE : undefined,
    pendingLabel: PENDING_LABEL,
  };
}

export function leaveOptions(): ConfirmOptions {
  return {
    tone: 'danger',
    title: 'Leave without sending?',
    message: 'This broadcast has not been sent. Leaving the page discards the draft.',
    confirmLabel: 'Discard and leave',
    cancelLabel: 'Keep editing',
  };
}

export function discardOptions(): ConfirmOptions {
  return {
    title: 'Clear this draft?',
    message: 'The audience, title, message and chosen user are cleared. Nothing has been sent, so users see nothing.',
    confirmLabel: 'Clear draft',
    cancelLabel: 'Keep editing',
  };
}
