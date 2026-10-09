export type ConfirmPhase = 'idle' | 'pending' | 'failed';

export interface ConfirmResult<T = unknown> {
  reason: string;
  value?: T;
}

export interface ConfirmValues {
  typed: string;
  acknowledged: boolean;
  reason: string;
  preset: string;
}

export interface ConfirmRules {
  requireTyped?: string;
  acknowledge?: string;
  reason?: { required?: boolean };
}

export interface ConfirmActionSpec {
  action?: (result: ConfirmResult) => Promise<unknown>;
  actionErrorMessage?: (error: unknown) => string;
}

export interface ConfirmSession<O> {
  readonly id: number;
  readonly options: O;
  readonly phase: ConfirmPhase;
  readonly error: string | null;
}

export interface ConfirmController<O extends ConfirmActionSpec> {
  getSession: () => ConfirmSession<O> | null;
  subscribe: (listener: () => void) => () => void;
  request: (options: O) => Promise<ConfirmResult | null>;
  submit: (id: number, result: ConfirmResult) => boolean;
  cancel: (id: number) => boolean;
  navigate: () => boolean;
}

export const OTHER_REASON = '__custom__';

export const DEFAULT_PENDING_LABEL = 'Working…';

export const ACTION_FAILED_MESSAGE =
  'This did not finish, so it may or may not have gone through. Check the current status before you try again.';

export const EMPTY_CONFIRM_VALUES: Readonly<ConfirmValues> = Object.freeze({
  typed: '', acknowledged: false, reason: '', preset: '',
});

const PLATFORM_ERROR_NAMES = new Set([
  'AbortError', 'AggregateError', 'EvalError', 'InternalError', 'RangeError', 'ReferenceError', 'SyntaxError',
  'TimeoutError', 'TypeError', 'URIError',
]);

export function effectiveReason(values: Pick<ConfirmValues, 'reason' | 'preset'>): string {
  return (values.preset === OTHER_REASON ? values.reason : values.preset || values.reason).trim();
}

export function canConfirm(rules: ConfirmRules, values: ConfirmValues): boolean {
  const typedOk = !rules.requireTyped || values.typed.trim() === rules.requireTyped;
  const acknowledgedOk = !rules.acknowledge || values.acknowledged;
  const reasonOk = !rules.reason?.required || effectiveReason(values).length > 0;
  return typedOk && acknowledgedOk && reasonOk;
}

export function choosePreset(values: ConfirmValues, preset: string): ConfirmValues {
  return { ...values, preset, reason: preset === OTHER_REASON ? values.reason : '' };
}

function isPlatformError(error: Error): boolean {
  if (PLATFORM_ERROR_NAMES.has(error.name)) return true;
  return typeof DOMException !== 'undefined' && error instanceof DOMException;
}

function describedBy(describe: (error: unknown) => string, error: unknown): string {
  try {
    const text = describe(error);
    return typeof text === 'string' ? text.trim() : '';
  } catch {
    return '';
  }
}

export function actionErrorText(error: unknown, describe?: (error: unknown) => string): string {
  const custom = describe ? describedBy(describe, error) : '';
  if (custom) return custom;
  if (error instanceof Error && !isPlatformError(error) && error.message.trim()) return error.message.trim();
  return ACTION_FAILED_MESSAGE;
}

export function createConfirmController<O extends ConfirmActionSpec>(): ConfirmController<O> {
  let session: ConfirmSession<O> | null = null;
  let resolveSession: ((result: ConfirmResult | null) => void) | null = null;
  let sequence = 0;
  const listeners = new Set<() => void>();

  const emit = () => {
    for (const listener of Array.from(listeners)) listener();
  };

  const settle = (result: ConfirmResult | null) => {
    const resolve = resolveSession;
    session = null;
    resolveSession = null;
    resolve?.(result);
    emit();
  };

  const patch = (id: number, phase: ConfirmPhase, error: string | null) => {
    if (!session || session.id !== id) return;
    session = { ...session, phase, error };
    emit();
  };

  const run = (
    id: number,
    result: ConfirmResult,
    action: NonNullable<ConfirmActionSpec['action']>,
    describe: ConfirmActionSpec['actionErrorMessage'],
  ) => {
    let outcome: Promise<unknown>;
    try {
      outcome = Promise.resolve(action(result));
    } catch (error) {
      outcome = Promise.reject(error);
    }
    outcome.then(
      (value) => {
        if (session?.id === id) settle({ ...result, value });
      },
      (error: unknown) => {
        patch(id, 'failed', actionErrorText(error, describe));
      },
    );
  };

  return {
    getSession: () => session,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    request: (options) => {
      if (session?.phase === 'pending') return Promise.resolve(null);
      return new Promise<ConfirmResult | null>((resolve) => {
        const previous = resolveSession;
        sequence += 1;
        session = { id: sequence, options, phase: 'idle', error: null };
        resolveSession = resolve;
        previous?.(null);
        emit();
      });
    },
    submit: (id, result) => {
      const current = session;
      if (!current || current.id !== id || current.phase === 'pending') return false;
      const { action, actionErrorMessage } = current.options;
      if (!action) {
        settle(result);
        return true;
      }
      patch(id, 'pending', null);
      run(id, result, action, actionErrorMessage);
      return true;
    },
    cancel: (id) => {
      if (!session || session.id !== id || session.phase === 'pending') return false;
      settle(null);
      return true;
    },
    navigate: () => {
      if (!session || session.phase === 'pending') return false;
      settle(null);
      return true;
    },
  };
}
