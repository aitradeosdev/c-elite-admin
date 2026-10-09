'use client';

import {
  createContext, useCallback, useContext, useEffect, useRef, useState, useSyncExternalStore,
  type ReactNode,
} from 'react';
import { usePathname } from 'next/navigation';
import { AlertTriangle, Banknote, EyeOff, HelpCircle, LoaderCircle } from 'lucide-react';
import { Modal } from './Overlay';
import { Button } from './Button';
import { Checkbox } from './Checkbox';
import { FieldShell, Input, Textarea } from './Field';
import { RadioGroup } from './RadioGroup';
import {
  DEFAULT_PENDING_LABEL, EMPTY_CONFIRM_VALUES, OTHER_REASON, canConfirm, choosePreset, createConfirmController,
  effectiveReason, type ConfirmResult, type ConfirmSession, type ConfirmValues,
} from './confirmModel';
import s from './Confirm.module.css';

export type { ConfirmPhase, ConfirmResult, ConfirmSession } from './confirmModel';

export type ConfirmTone = 'default' | 'danger' | 'financial' | 'sensitive';

export interface ConfirmDetail {
  label: string;
  value: ReactNode;
  mono?: boolean;
  emphasis?: boolean;
}

export interface ConfirmReasonSpec {
  label?: string;
  placeholder?: string;
  required?: boolean;
  presets?: string[];
  maxLength?: number;
}

export interface ConfirmOptions<T = unknown> {
  tone?: ConfirmTone;
  title: string;
  message?: ReactNode;
  details?: ConfirmDetail[];
  consequences?: string[];
  confirmLabel?: string;
  cancelLabel?: string;
  acknowledge?: string;
  requireTyped?: string;
  reason?: ConfirmReasonSpec;
  action?: (result: ConfirmResult) => Promise<T>;
  pendingLabel?: string;
  actionErrorMessage?: (error: unknown) => string;
  returnFocusTo?: () => HTMLElement | null;
}

export type ConfirmFn = <T = unknown>(options: ConfirmOptions<T>) => Promise<ConfirmResult<T> | null>;

const ConfirmContext = createContext<ConfirmFn | null>(null);

const TONE_ICON: Record<ConfirmTone, ReactNode> = {
  default: <HelpCircle size={16} aria-hidden />,
  danger: <AlertTriangle size={16} aria-hidden />,
  financial: <Banknote size={16} aria-hidden />,
  sensitive: <EyeOff size={16} aria-hidden />,
};

const TONE_CLASS: Record<ConfirmTone, string> = {
  default: s.toneDefault,
  danger: s.toneDanger,
  financial: s.toneFinancial,
  sensitive: s.toneSensitive,
};

const serverSession = () => null;

export interface ConfirmDialogProps {
  session: ConfirmSession<ConfirmOptions>;
  onSubmit: (result: ConfirmResult) => void;
  onCancel: () => void;
}

export function ConfirmDialog({ session, onSubmit, onCancel }: ConfirmDialogProps) {
  const { options, phase, error } = session;
  const [values, setValues] = useState<ConfirmValues>(EMPTY_CONFIRM_VALUES);
  const [valuesFor, setValuesFor] = useState(session.id);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const busy = phase === 'pending';

  if (valuesFor !== session.id) {
    setValuesFor(session.id);
    setValues(EMPTY_CONFIRM_VALUES);
  }

  useEffect(() => {
    if (!busy) return;
    const button = confirmRef.current;
    if (!button) return;
    const active = document.activeElement;
    const dialog = button.closest('[role="dialog"]');
    const keep = active instanceof HTMLElement
      && active !== document.body
      && Boolean(dialog?.contains(active))
      && !active.matches(':disabled');
    if (!keep) button.focus({ preventScroll: true });
  }, [busy]);

  const tone: ConfirmTone = options.tone ?? 'default';
  const reasonSpec = options.reason;
  const reasonLabel = reasonSpec?.label || 'Reason';
  const hasPresets = Boolean(reasonSpec?.presets?.length);
  const ready = canConfirm(options, values);

  const update = (patch: Partial<ConfirmValues>) => setValues((current) => ({ ...current, ...patch }));

  const submit = () => {
    if (busy || !ready) return;
    onSubmit({ reason: effectiveReason(values) });
  };

  return (
    <Modal
      open
      onClose={onCancel}
      static={busy}
      size={options.details?.length || reasonSpec ? 'md' : 'sm'}
      hideClose
      returnFocusTo={options.returnFocusTo}
      title={
        <span className={[s.titleRow, TONE_CLASS[tone]].join(' ')}>
          <span className={s.titleIcon}>{TONE_ICON[tone]}</span>
          <span>{options.title}</span>
        </span>
      }
      footer={
        <div className={s.footer}>
          {phase === 'failed' && error ? (
            <div className={s.error} role="alert">
              <AlertTriangle size={14} aria-hidden className={s.errorIcon} />
              <span>{error}</span>
            </div>
          ) : null}
          <div className={s.bar}>
            {options.action ? (
              <p className={s.status} role="status">
                {busy ? options.pendingLabel || DEFAULT_PENDING_LABEL : null}
              </p>
            ) : null}
            <div className={s.actions}>
              <Button variant="ghost" disabled={busy} onClick={onCancel}>
                {options.cancelLabel || 'Cancel'}
              </Button>
              <Button
                ref={confirmRef}
                variant={tone === 'danger' ? 'danger' : 'primary'}
                disabled={!busy && !ready}
                aria-disabled={busy || undefined}
                aria-busy={busy || undefined}
                leftIcon={busy ? <LoaderCircle size={14} aria-hidden className={s.spinner} /> : undefined}
                onClick={submit}
              >
                {options.confirmLabel || 'Confirm'}
              </Button>
            </div>
          </div>
        </div>
      }
    >
      {options.message ? <div className={s.message}>{options.message}</div> : null}

      {options.details?.length ? (
        <dl className={s.details}>
          {options.details.map((d) => (
            <div key={d.label} className={s.detailRow}>
              <dt className={s.detailLabel}>{d.label}</dt>
              <dd
                className={[
                  s.detailValue,
                  d.mono && s.detailMono,
                  d.emphasis && s.detailEmphasis,
                ].filter(Boolean).join(' ')}
              >
                {d.value}
              </dd>
            </div>
          ))}
        </dl>
      ) : null}

      {options.consequences?.length ? (
        <ul className={[s.consequences, TONE_CLASS[tone]].join(' ')}>
          {options.consequences.map((c) => <li key={c}>{c}</li>)}
        </ul>
      ) : null}

      {reasonSpec ? (
        <div className={s.block}>
          {hasPresets ? (
            <RadioGroup
              className={s.presets}
              legend={reasonLabel}
              required={reasonSpec.required}
              disabled={busy}
              options={[
                ...(reasonSpec.presets ?? []).map((option) => ({ value: option, label: option })),
                { value: OTHER_REASON, label: 'Other' },
              ]}
              value={values.preset}
              onChange={(next) => setValues((current) => choosePreset(current, next))}
            />
          ) : null}
          {(!hasPresets || values.preset === OTHER_REASON) ? (
            <FieldShell
              label={hasPresets ? undefined : reasonLabel}
              required={reasonSpec.required}
              help={reasonSpec.required ? 'Recorded in the audit log.' : undefined}
            >
              <Textarea
                aria-label={hasPresets ? `Other ${reasonLabel.toLowerCase()}` : undefined}
                rows={3}
                value={values.reason}
                maxLength={reasonSpec.maxLength ?? 500}
                placeholder={reasonSpec.placeholder || 'Why are you doing this?'}
                readOnly={busy}
                className={busy ? s.readOnly : undefined}
                onChange={(e) => update({ reason: e.target.value })}
              />
            </FieldShell>
          ) : null}
        </div>
      ) : null}

      {options.requireTyped ? (
        <div className={s.block}>
          <FieldShell
            label={<>Type <code className={s.typedPhrase}>{options.requireTyped}</code> to continue</>}
            required
          >
            <Input
              mono
              value={values.typed}
              onChange={(e) => update({ typed: e.target.value })}
              placeholder={options.requireTyped}
              autoComplete="off"
              spellCheck={false}
              readOnly={busy}
              className={busy ? s.readOnly : undefined}
            />
          </FieldShell>
        </div>
      ) : null}

      {options.acknowledge ? (
        <Checkbox
          checked={values.acknowledged}
          onChange={(next) => update({ acknowledged: next })}
          label={options.acknowledge}
          disabled={busy}
        />
      ) : null}
    </Modal>
  );
}

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [controller] = useState(() => createConfirmController<ConfirmOptions>());
  const session = useSyncExternalStore(controller.subscribe, controller.getSession, serverSession);
  const pathname = usePathname();

  useEffect(() => {
    controller.navigate();
  }, [controller, pathname]);

  const confirm = useCallback<ConfirmFn>(
    <T,>(options: ConfirmOptions<T>) => controller.request(options) as Promise<ConfirmResult<T> | null>,
    [controller],
  );

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      {session ? (
        <ConfirmDialog
          session={session}
          onSubmit={(result) => controller.submit(session.id, result)}
          onCancel={() => controller.cancel(session.id)}
        />
      ) : null}
    </ConfirmContext.Provider>
  );
}

export function useConfirm(): ConfirmFn {
  const ctx = useContext(ConfirmContext);
  if (!ctx) {
    throw new Error('useConfirm must be used inside <ConfirmProvider>');
  }
  return ctx;
}
