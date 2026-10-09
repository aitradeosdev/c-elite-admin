import type { ConfirmDetail, ConfirmOptions } from '../../_ui';
import { REASON_MAX_LENGTH, type TemplateChannel, type TemplateRecord } from './templateRules';
import { templateName, type ActiveChange, type FieldChange, type SaveOutcome } from './templateModel';
import { ChangeReview, StateChange } from './TemplateParts';

export interface RemovedVariables {
  label: string;
  names: readonly string[];
}

export interface SaveReviewInput {
  channel: TemplateChannel;
  template: TemplateRecord;
  changes: readonly FieldChange[];
  active: ActiveChange | null;
  conflicts: readonly string[];
  removed: readonly RemovedVariables[];
}

function stateText(active: boolean): string {
  return active ? 'Sending' : 'Switched off';
}

function tokens(names: readonly string[]): string {
  return names.map((name) => `{${name}}`).join(', ');
}

export function saveConsequences(input: SaveReviewInput): string[] {
  const email = input.channel.id === 'email';
  const lines: string[] = [];
  for (const label of input.conflicts) {
    lines.push(`Another admin changed the ${label.toLowerCase()} after you opened this template. Saving replaces their version with yours.`);
  }
  if (input.active?.after === false) {
    lines.push(email
      ? 'While it is switched off, this email is not sent.'
      : 'While it is switched off, users get no notification for this event, and notifications skipped while it is off are not sent later.');
  }
  if (input.active?.after === true) {
    lines.push(email
      ? 'This email is sent again for new events.'
      : 'Users get this notification again for new events. Events that happened while it was off are not sent.');
  }
  for (const entry of input.removed) {
    if (entry.names.length === 0) continue;
    lines.push(`The ${entry.label.toLowerCase()} no longer includes ${tokens(entry.names)}, so users will not see ${entry.names.length === 1 ? 'that value' : 'those values'}.`);
  }
  return lines;
}

export function saveOptions(input: SaveReviewInput): ConfirmOptions<SaveOutcome> {
  const name = templateName(input.template);
  const email = input.channel.id === 'email';
  const textChanged = input.changes.length > 0;
  const switchingOff = input.active?.after === false;
  const consequences = saveConsequences(input);
  const details: ConfirmDetail[] = [{ label: 'Template', value: input.template.key, mono: true }];
  if (input.active) {
    details.push({
      label: 'Sending',
      value: <StateChange from={stateText(input.active.before)} to={stateText(input.active.after)} />,
    });
  }
  const lead = textChanged
    ? `The next ${email ? 'email' : 'notification'} sent for this event uses the new version. ${email ? 'Emails' : 'Notifications'} already sent do not change. The change is recorded in the audit log.`
    : 'The change is recorded in the audit log.';
  let title = `Switch on ${name}?`;
  let confirmLabel = 'Switch on';
  if (textChanged) {
    title = `Save changes to ${name}?`;
    confirmLabel = 'Save changes';
  } else if (switchingOff) {
    title = `Switch off ${name}?`;
    confirmLabel = 'Switch off';
  }
  return {
    tone: switchingOff ? 'danger' : 'default',
    title,
    message: <ChangeReview lead={lead} changes={input.changes} />,
    details,
    consequences: consequences.length > 0 ? consequences : undefined,
    reason: {
      label: 'Note for the audit log',
      placeholder: 'Optional: why are you making this change?',
      maxLength: REASON_MAX_LENGTH,
    },
    confirmLabel,
    cancelLabel: 'Keep editing',
    pendingLabel: 'Saving the template…',
  };
}

export function discardOptions(record: TemplateRecord): ConfirmOptions {
  return {
    title: 'Discard your changes?',
    message: `Nothing has been saved, so ${templateName(record)} stays exactly as it is.`,
    confirmLabel: 'Discard changes',
    cancelLabel: 'Keep editing',
  };
}
