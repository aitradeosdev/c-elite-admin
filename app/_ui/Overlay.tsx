'use client';

import { ReactNode, useCallback, useId } from 'react';
import { X } from 'lucide-react';
import { useFocusTrap } from './useFocusTrap';
import s from './Overlay.module.css';

export type ModalSize = 'sm' | 'md' | 'lg' | 'xl';

export interface ModalProps {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  subtitle?: ReactNode;
  hideClose?: boolean;
  size?: ModalSize;
  footer?: ReactNode;
  static?: boolean;
  returnFocusTo?: () => HTMLElement | null;
  children: ReactNode;
}

export function Modal({
  open, onClose, title, subtitle, hideClose, size = 'md', footer, static: isStatic, returnFocusTo, children,
}: ModalProps) {
  const close = useCallback(() => { if (!isStatic) onClose(); }, [isStatic, onClose]);
  const trapRef = useFocusTrap<HTMLDivElement>(open, close, { returnFocusTo });
  const baseId = useId();
  const titleId = `${baseId}-title`;
  const subtitleId = `${baseId}-subtitle`;

  if (!open) return null;
  const sizeClass = size === 'sm' ? s.sizeSm : size === 'lg' ? s.sizeLg : size === 'xl' ? s.sizeXl : s.sizeMd;
  return (
    <div className={s.scrim} onClick={close}>
      <div
        ref={trapRef}
        className={[s.modal, sizeClass].join(' ')}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? titleId : undefined}
        aria-describedby={subtitle ? subtitleId : undefined}
      >
        {(title || !hideClose) ? (
          <div className={s.head}>
            <div>
              {title ? <div id={titleId} className={s.title}>{title}</div> : null}
              {subtitle ? <div id={subtitleId} className={s.subtitle}>{subtitle}</div> : null}
            </div>
            {!hideClose ? (
              <button type="button" className={s.closeBtn} onClick={close} aria-label="Close">
                <X size={16} aria-hidden />
              </button>
            ) : null}
          </div>
        ) : null}
        <div className={s.body}>{children}</div>
        {footer ? <div className={s.foot}>{footer}</div> : null}
      </div>
    </div>
  );
}

export interface SidePanelProps {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  subtitle?: ReactNode;
  hideClose?: boolean;
  wide?: boolean;
  footer?: ReactNode;
  returnFocusTo?: () => HTMLElement | null;
  children: ReactNode;
}

export function SidePanel({
  open, onClose, title, subtitle, hideClose, wide, footer, returnFocusTo, children,
}: SidePanelProps) {
  const trapRef = useFocusTrap<HTMLElement>(open, onClose, { returnFocusTo });
  const baseId = useId();
  const titleId = `${baseId}-title`;
  const subtitleId = `${baseId}-subtitle`;

  if (!open) return null;
  return (
    <>
      <div className={s.panelScrim} onClick={onClose} aria-hidden />
      <aside
        ref={trapRef}
        className={[s.panel, wide && s.panelWide].filter(Boolean).join(' ')}
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? titleId : undefined}
        aria-describedby={subtitle ? subtitleId : undefined}
      >
        {(title || !hideClose) ? (
          <div className={s.head}>
            <div>
              {title ? <div id={titleId} className={s.title}>{title}</div> : null}
              {subtitle ? <div id={subtitleId} className={s.subtitle}>{subtitle}</div> : null}
            </div>
            {!hideClose ? (
              <button type="button" className={s.closeBtn} onClick={onClose} aria-label="Close panel">
                <X size={16} aria-hidden />
              </button>
            ) : null}
          </div>
        ) : null}
        <div className={s.body}>{children}</div>
        {footer ? <div className={s.foot}>{footer}</div> : null}
      </aside>
    </>
  );
}
