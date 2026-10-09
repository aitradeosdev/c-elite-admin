'use client';

import { HTMLAttributes, MouseEvent, ReactNode, forwardRef, useCallback, useRef } from 'react';
import { X } from 'lucide-react';
import { Button } from './Button';
import { focusableWithin } from './overlayStack';
import s from './FilterBar.module.css';

export interface FilterBarProps extends Omit<HTMLAttributes<HTMLDivElement>, 'children'> {
  search?: ReactNode;
  filters?: ReactNode;
  actions?: ReactNode;
  onClear?: () => void;
  active?: boolean;
}

export const FilterBar = forwardRef<HTMLDivElement, FilterBarProps>(function FilterBar(
  {
    search,
    filters,
    actions,
    onClear,
    active,
    role = 'search',
    'aria-label': ariaLabel,
    'aria-labelledby': ariaLabelledBy,
    className,
    ...rest
  },
  ref,
) {
  const rootRef = useRef<HTMLDivElement | null>(null);

  const setRef = useCallback((node: HTMLDivElement | null) => {
    rootRef.current = node;
    if (typeof ref === 'function') ref(node);
    else if (ref) ref.current = node;
  }, [ref]);

  const handleClear = (event: MouseEvent<HTMLButtonElement>) => {
    const button = event.currentTarget;
    const fromKeyboard = event.detail === 0;
    onClear?.();
    const root = rootRef.current;
    if (!fromKeyboard || active === undefined || !root) return;
    const next = focusableWithin(root).find((el) => el !== button);
    if (next) {
      next.focus({ preventScroll: true });
      return;
    }
    if (!root.hasAttribute('tabindex')) root.setAttribute('tabindex', '-1');
    root.focus({ preventScroll: true });
  };

  return (
    <div
      {...rest}
      ref={setRef}
      role={role}
      aria-label={ariaLabelledBy ? ariaLabel : ariaLabel ?? 'Filters'}
      aria-labelledby={ariaLabelledBy}
      className={[s.bar, className].filter(Boolean).join(' ')}
    >
      {search ? <div className={s.search}>{search}</div> : null}
      {filters ? <div className={s.filters}>{filters}</div> : null}
      {onClear && active !== false ? (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className={s.clear}
          leftIcon={<X size={14} />}
          onClick={handleClear}
        >
          Clear filters
        </Button>
      ) : null}
      {actions ? <div className={s.actions}>{actions}</div> : null}
    </div>
  );
});
