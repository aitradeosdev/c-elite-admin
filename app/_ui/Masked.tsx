import { forwardRef, type HTMLAttributes } from 'react';
import { maskForDisplay, type MaskKind } from '../lib/mask';
import s from './Masked.module.css';

export type { MaskKind } from '../lib/mask';

export interface MaskedValueProps extends Omit<HTMLAttributes<HTMLSpanElement>, 'children'> {
  value: unknown;
  visible?: number;
  kind?: MaskKind;
  srLabel?: string;
}

export const MaskedValue = forwardRef<HTMLSpanElement, MaskedValueProps>(function MaskedValue(
  { value, visible, kind = 'generic', srLabel, className, ...rest },
  ref,
) {
  const masked = maskForDisplay(value, { visible, kind, label: srLabel });
  return (
    <span
      ref={ref}
      translate="no"
      {...rest}
      className={[s.masked, masked.empty && s.missing, className].filter(Boolean).join(' ')}
    >
      <span aria-hidden>{masked.text}</span>
      <span className={s.srOnly}>{masked.spoken}</span>
    </span>
  );
});
