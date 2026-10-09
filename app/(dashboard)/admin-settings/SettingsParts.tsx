'use client';

import type { ReactNode, Ref } from 'react';
import { LoaderCircle } from 'lucide-react';
import {
  Button, Card, CardBody, CardHeader, FieldShell, Input, Notice, RadioGroup, Select, Skeleton, StatusDot, Toggle,
  formatNaira,
} from '../../_ui';
import { MASK } from '../../lib/mask';
import { formatAge, formatBusinessDateTime } from '../../lib/time';
import { IDENTITY_KEY, settingLabel } from './rules';
import {
  SECTIONS, plural,
  type EmergencyState, type LiveNotice, type SecretDraft, type SecretState, type SettingField, type SettingSection,
} from './model';
import type { ConfigValues } from '../_config/ConfigForm';
import s from './page.module.css';

export type Phase = 'idle' | 'checking' | 'confirming';

export interface ProviderOption {
  value: string;
  label: string;
  flagKey: string;
}

function classes(...names: Array<string | false | null | undefined>): string {
  return names.filter(Boolean).join(' ');
}

export function ModifiedMark() {
  return (
    <span className={s.modified}>
      <span className={s.modifiedDot} aria-hidden />
      Unsaved
    </span>
  );
}

function FieldLabel({ label, modified }: { label: ReactNode; modified: boolean }) {
  return (
    <>
      {label}
      {modified ? <ModifiedMark /> : null}
    </>
  );
}

export interface DiffValueProps {
  from: string;
  to: string;
  mono?: boolean;
  fromMissing?: boolean;
  toMissing?: boolean;
}

export function DiffValue({ from, to, mono, fromMissing, toMissing }: DiffValueProps) {
  return (
    <span className={s.diff}>
      <span className={s.srOnly}>From </span>
      <span className={classes(s.diffFrom, fromMissing ? s.emptyValue : mono && s.mono)}>{from}</span>
      <span className={s.diffArrow} aria-hidden>→</span>
      <span className={s.srOnly}> to </span>
      <span className={classes(s.diffTo, toMissing ? s.emptyValue : mono && s.mono)}>{to}</span>
    </span>
  );
}

export interface SectionCardProps {
  headingId: string;
  title: string;
  description?: string;
  children: ReactNode;
}

export function SectionCard({ headingId, title, description, children }: SectionCardProps) {
  return (
    <Card role="group" aria-labelledby={headingId}>
      <CardHeader title={<h2 id={headingId} className={s.sectionHeading}>{title}</h2>} subtitle={description} />
      <CardBody className={s.body}>{children}</CardBody>
    </Card>
  );
}

export interface EmergencyCardProps {
  state: EmergencyState;
  headingId: string;
  busy: boolean;
  disabled: boolean;
  buttonRef: Ref<HTMLButtonElement>;
  onToggle: (turnOn: boolean) => void;
}

export function EmergencyCard({ state, headingId, busy, disabled, buttonRef, onToggle }: EmergencyCardProps) {
  const { on, since } = state;
  const sinceText = since ? `${formatBusinessDateTime(since)} WAT` : null;
  return (
    <Card role="region" aria-labelledby={headingId} className={classes(s.emergency, on && s.emergencyOn)}>
      <CardHeader
        title={<h2 id={headingId} className={s.sectionHeading}>Emergency mode</h2>}
        subtitle="The platform-wide kill switch. While it is on, users see a maintenance screen and the server refuses new withdrawals and bill payments."
        actions={<StatusDot status={on ? 'on' : 'off'} tone={on ? 'danger' : 'neutral'} label={on ? 'On' : 'Off'} />}
      />
      <CardBody className={s.emergencyBody}>
        {on ? (
          <Notice
            tone="danger"
            flush
            title="Emergency mode is on"
            meta={sinceText ? `On since ${sinceText} (${formatAge(since)} ago)` : undefined}
          >
            Users cannot use the app, and new withdrawals and bill payments are refused until it is turned off.
          </Notice>
        ) : null}
        <div className={s.emergencyRow}>
          <p className={s.emergencyMeta}>
            {on
              ? 'Turn it off once the incident is resolved.'
              : sinceText
                ? `Off since ${sinceText}. Users can use the app normally.`
                : 'Off. Users can use the app normally.'}
          </p>
          <Button
            ref={buttonRef}
            type="button"
            variant={on ? 'primary' : 'dangerSubtle'}
            loading={busy}
            disabled={disabled}
            onClick={() => onToggle(!on)}
          >
            {on ? 'Turn off emergency mode…' : 'Turn on emergency mode…'}
          </Button>
        </div>
      </CardBody>
    </Card>
  );
}

export interface ProviderCardProps {
  section: SettingSection;
  headingId: string;
  primaryKey: string;
  providers: ReadonlyArray<ProviderOption>;
  noun: string;
  values: ConfigValues;
  errors: Readonly<Record<string, string>>;
  modified: ReadonlySet<string>;
  notice: LiveNotice | null;
  fieldId: (key: string) => string;
  onChange: (key: string, value: string) => void;
  onBlur: (key: string) => void;
}

export function ProviderCard({
  section, headingId, primaryKey, providers, noun, values, errors, modified, notice, fieldId, onChange, onBlur,
}: ProviderCardProps) {
  const primary = values[primaryKey] ?? '';
  const known = providers.some((option) => option.value === primary);
  const options = [
    ...(known || primary === '' ? [] : [{ value: primary, label: primary, disabled: true }]),
    ...providers.map((option) => {
      const on = values[option.flagKey] === 'true';
      return {
        value: option.value,
        label: option.label,
        disabled: !on && option.value !== primary,
        description: on ? undefined : 'Turned off',
      };
    }),
  ];
  return (
    <SectionCard headingId={headingId} title={section.title} description={section.description}>
      <div className={s.providers}>
        {notice ? (
          <Notice tone={notice.tone} compact flush title={notice.title}>{notice.message}</Notice>
        ) : null}
        <RadioGroup
          id={fieldId(primaryKey)}
          legend={<FieldLabel label={settingLabel(primaryKey)} modified={modified.has(primaryKey)} />}
          orientation="horizontal"
          options={options}
          value={primary}
          error={errors[primaryKey]}
          help={`Turn a ${noun} on before making it primary.`}
          onChange={(next) => {
            onChange(primaryKey, next);
            onBlur(primaryKey);
          }}
        />
        <fieldset className={s.switches}>
          <legend className={s.switchLegend}>Turned on</legend>
          <ul className={s.switchList}>
            {providers.map((option) => {
              const id = fieldId(option.flagKey);
              const on = values[option.flagKey] === 'true';
              const isPrimary = option.value === primary;
              const error = errors[option.flagKey];
              const errorId = `${id}-error`;
              return (
                <li key={option.value} className={s.switchRow}>
                  <Toggle
                    id={id}
                    label={option.label}
                    checked={on}
                    disabled={isPrimary && on}
                    aria-describedby={error ? errorId : undefined}
                    aria-invalid={error ? true : undefined}
                    onBlur={() => onBlur(option.flagKey)}
                    onChange={(next) => {
                      onChange(option.flagKey, next ? 'true' : 'false');
                      onBlur(option.flagKey);
                    }}
                  />
                  <span className={s.switchMeta}>
                    {isPrimary ? 'Primary' : on ? 'On' : 'Off'}
                    {modified.has(option.flagKey) ? <ModifiedMark /> : null}
                  </span>
                  {error ? <p id={errorId} className={s.switchError} role="alert">{error}</p> : null}
                </li>
              );
            })}
          </ul>
          <p className={s.help}>The primary {noun} stays on. Make another {noun} primary before turning it off.</p>
        </fieldset>
      </div>
    </SectionCard>
  );
}

export interface SettingInputProps {
  field: SettingField;
  id: string;
  value: string;
  error?: string;
  modified: boolean;
  onChange: (key: string, value: string) => void;
  onBlur: (key: string) => void;
}

function inputModeOf(field: SettingField): 'numeric' | 'decimal' | 'url' | undefined {
  if (field.kind === 'money') return 'numeric';
  if (field.kind === 'version') return 'decimal';
  if (field.kind === 'url') return 'url';
  return undefined;
}

export function SettingInput({ field, id, value, error, modified, onChange, onBlur }: SettingInputProps) {
  const blur = () => onBlur(field.key);
  const label = <FieldLabel label={field.label} modified={modified} />;
  const amount = field.kind === 'money' && /^\d+$/.test(value) ? formatNaira(value) : null;
  const help = amount ? (
    <>
      {field.hint}
      <span className={s.amount}>Reads as {amount}</span>
    </>
  ) : field.hint;

  if (field.input === 'select') {
    const options = field.options ?? [];
    const listed = options.some((option) => option.value === value);
    return (
      <FieldShell htmlFor={id} label={label} help={field.hint} error={error} className={field.wide ? s.wide : undefined}>
        <Select
          id={id}
          value={value}
          onBlur={blur}
          onChange={(event) => {
            onChange(field.key, event.target.value);
            onBlur(field.key);
          }}
        >
          {listed ? null : <option value={value}>{value === '' ? 'Not set' : value}</option>}
          {options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
        </Select>
      </FieldShell>
    );
  }

  const plain = field.kind === undefined || field.kind === 'text';
  return (
    <FieldShell htmlFor={id} label={label} help={help} error={error} className={field.wide ? s.wide : undefined}>
      <Input
        id={id}
        type={field.kind === 'url' ? 'url' : 'text'}
        inputMode={inputModeOf(field)}
        mono={!plain}
        value={value}
        placeholder={field.placeholder}
        maxLength={field.maxLength}
        autoComplete="off"
        spellCheck={plain ? undefined : false}
        autoCapitalize={plain ? undefined : 'off'}
        onBlur={blur}
        onChange={(event) => {
          const next = field.kind === 'money' ? event.target.value.replace(/[\s,₦]/g, '') : event.target.value;
          onChange(field.key, next);
        }}
      />
    </FieldShell>
  );
}

export interface SecretFieldProps {
  id: string;
  identity: SecretState;
  draft: SecretDraft;
  error?: string;
  onReplace: () => void;
  onRemove: () => void;
  onCancel: () => void;
  onValue: (value: string) => void;
  onBlur: () => void;
}

export function secretReplaceId(id: string): string {
  return `${id}-replace`;
}

export function secretUndoId(id: string): string {
  return `${id}-undo`;
}

export function SecretField({ id, identity, draft, error, onReplace, onRemove, onCancel, onValue, onBlur }: SecretFieldProps) {
  const labelId = `${id}-label`;
  const exposed = identity.exposed ? (
    <Notice tone="danger" compact flush title="This key is readable by the user app.">
      Generate a new key in Chatwoot and replace it here. Saving keeps the stored key private.
    </Notice>
  ) : null;

  if (draft.mode === 'replace') {
    return (
      <div className={classes(s.secret, s.wide)}>
        <FieldShell
          htmlFor={id}
          label={<FieldLabel label={settingLabel(IDENTITY_KEY)} modified />}
          help="Paste the key from the inbox’s Configuration tab in Chatwoot. It is stored privately and is never shown again."
          error={error}
        >
          <div className={s.secretEdit}>
            <Input
              id={id}
              type="password"
              mono
              value={draft.value}
              placeholder={identity.set ? 'New identity validation key' : 'Identity validation key'}
              autoComplete="new-password"
              spellCheck={false}
              autoCapitalize="off"
              onBlur={onBlur}
              onChange={(event) => onValue(event.target.value)}
            />
            <Button type="button" variant="ghost" onClick={onCancel}>Cancel</Button>
          </div>
        </FieldShell>
        {exposed}
      </div>
    );
  }

  const removing = draft.mode === 'clear';
  return (
    <div className={classes(s.secret, s.wide)} role="group" aria-labelledby={labelId}>
      <span id={labelId} className={s.secretLabel}>
        <FieldLabel label={settingLabel(IDENTITY_KEY)} modified={removing} />
      </span>
      <div className={s.secretRow}>
        <div className={s.secretState}>
          {removing ? (
            <span className={s.secretStatus}>Removed when you apply</span>
          ) : identity.set ? (
            <>
              <span className={s.secretMask} aria-hidden>{MASK}{MASK}</span>
              <span className={s.secretStatus}>Stored</span>
            </>
          ) : (
            <span className={s.secretEmpty}>Not set</span>
          )}
          {identity.set && identity.updatedAt ? (
            <span className={s.secretMeta}>Updated {formatBusinessDateTime(identity.updatedAt)} WAT</span>
          ) : null}
        </div>
        <div className={s.secretActions}>
          {removing ? (
            <Button id={secretUndoId(id)} type="button" variant="secondary" size="sm" onClick={onCancel}>Undo</Button>
          ) : (
            <>
              <Button id={secretReplaceId(id)} type="button" variant="secondary" size="sm" onClick={onReplace}>
                {identity.set ? 'Replace' : 'Add key'}
              </Button>
              {identity.set ? (
                <Button type="button" variant="ghost" size="sm" onClick={onRemove}>Remove</Button>
              ) : null}
            </>
          )}
        </div>
      </div>
      {exposed}
      <p className={s.help}>
        Optional. Only the server uses it, to prove which signed-in user opened a chat. It is never sent to the app.
      </p>
    </div>
  );
}

export interface SaveBarProps {
  count: number;
  issues: number;
  phase: Phase;
  reviewRef: Ref<HTMLButtonElement>;
  onDiscard: () => void;
}

export function SaveBar({ count, issues, phase, reviewRef, onDiscard }: SaveBarProps) {
  const working = phase !== 'idle';
  const status = phase === 'checking'
    ? 'Checking the live values…'
    : phase === 'confirming'
      ? `Reviewing ${plural(count, 'change')}…`
      : plural(count, 'unsaved change');
  return (
    <div className={s.bar} role="region" aria-label="Unsaved changes">
      <p className={s.barStatus} role="status">
        <span className={s.barDot} aria-hidden />
        <span>{status}</span>
        {issues > 0 && !working ? <span className={s.barIssues}>{plural(issues, 'field')} to fix</span> : null}
      </p>
      <div className={s.barActions}>
        <Button type="button" variant="ghost" aria-disabled={working || undefined} onClick={onDiscard}>
          Discard
        </Button>
        <Button
          ref={reviewRef}
          type="submit"
          variant="primary"
          aria-disabled={working || undefined}
          aria-busy={phase === 'checking' || undefined}
          leftIcon={phase === 'checking' ? <LoaderCircle size={14} aria-hidden className={s.spin} /> : undefined}
        >
          {phase === 'checking' ? 'Checking…' : 'Review changes'}
        </Button>
      </div>
    </div>
  );
}

export function SettingsSkeleton() {
  return (
    <div aria-busy="true">
      <span className={s.srOnly} role="status">Loading settings…</span>
      <Card aria-hidden>
        <CardHeader
          title="Emergency mode"
          subtitle="The platform-wide kill switch. While it is on, users see a maintenance screen and the server refuses new withdrawals and bill payments."
        />
        <CardBody className={s.emergencyBody}>
          <div className={s.emergencyRow}>
            <Skeleton width="45%" height={12} />
            <Skeleton width={196} height={34} />
          </div>
        </CardBody>
      </Card>
      <div className={s.form}>
        {SECTIONS.map((section) => (
          <Card key={section.id} aria-hidden>
            <CardHeader title={section.title} subtitle={section.description} />
            <CardBody className={s.body}>
              <div className={s.grid}>
                {section.fields.slice(0, 4).map((field) => (
                  <div key={field.key} className={s.skeletonField}>
                    <Skeleton width="38%" height={11} />
                    <Skeleton
                      width={field.input === 'toggle' ? 36 : '100%'}
                      height={field.input === 'toggle' ? 20 : 34}
                      rounded={field.input === 'toggle'}
                    />
                  </div>
                ))}
              </div>
            </CardBody>
          </Card>
        ))}
      </div>
    </div>
  );
}
