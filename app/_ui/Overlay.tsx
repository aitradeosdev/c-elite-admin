'use client';

import { ReactNode, useEffect, useCallback } from 'react';
import { X } from 'lucide-react';
import s from './Overlay.module.css';

export type ModalSize = 'sm' | 'md' | 'lg' | 'xl';

export interface ModalProps {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  subtitle?: ReactNode;
  /** Hide the X close button in the header. */
  hideClose?: boolean;
  size?: ModalSize;
  /** Footer node — usually a row of <Button>s. */
  footer?: ReactNode;
  /** Disable scrim-click and Escape-key closing. Use for non-dismissable
   *  flows like in-progress async work. */
  static?: boolean;
  children: ReactNode;
}

export function Modal({
  open, onClose, title, subtitle, hideClose, size = 'md', footer, static: isStatic, children,
}: ModalProps) {
  const close = useCallback(() => { if (!isStatic) onClose(); }, [isStatic, onClose]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, close]);

  if (!open) return null;
  const sizeClass = size === 'sm' ? s.sizeSm : size === 'lg' ? s.sizeLg : size === 'xl' ? s.sizeXl : s.sizeMd;
  return (
    <div className={s.scrim} onClick={close} role="dialog" aria-modal="true">
      <div className={[s.modal, sizeClass].join(' ')} onClick={(e) => e.stopPropagation()}>
        {(title || !hideClose) ? (
          <div className={s.head}>
            <div>
              {title ? <div className={s.title}>{title}</div> : null}
              {subtitle ? <div className={s.subtitle}>{subtitle}</div> : null}
            </div>
            {!hideClose ? (
              <button type="button" className={s.closeBtn} onClick={close} aria-label="Close">
                <X size={16} />
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
  children: ReactNode;
}

export function SidePanel({ open, onClose, title, subtitle, hideClose, wide, footer, children }: SidePanelProps) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <>
      <div className={s.panelScrim} onClick={onClose} aria-hidden />
      <aside className={[s.panel, wide && s.panelWide].filter(Boolean).join(' ')} role="dialog" aria-modal="true">
        {(title || !hideClose) ? (
          <div className={s.head}>
            <div>
              {title ? <div className={s.title}>{title}</div> : null}
              {subtitle ? <div className={s.subtitle}>{subtitle}</div> : null}
            </div>
            {!hideClose ? (
              <button type="button" className={s.closeBtn} onClick={onClose} aria-label="Close panel">
                <X size={16} />
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
