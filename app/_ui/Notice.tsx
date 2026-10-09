'use client';

import { createContext, forwardRef, useContext, type ReactNode } from 'react';
import { CircleCheck, Info, OctagonAlert, TriangleAlert, X, type LucideIcon } from 'lucide-react';
import s from './Notice.module.css';

export type NoticeTone = 'info' | 'success' | 'warning' | 'danger' | 'neutral';
export type NoticeVariant = 'banner' | 'callout';
export type NoticeAnnounce = boolean | 'polite' | 'assertive';
export type NoticeRole = 'alert' | 'status';

export interface NoticeProps {
  tone: NoticeTone;
  title?: ReactNode;
  children?: ReactNode;
  meta?: ReactNode;
  actions?: ReactNode;
  onDismiss?: () => void;
  dismissLabel?: string;
  icon?: ReactNode | null;
  announce?: NoticeAnnounce;
  variant?: NoticeVariant;
  compact?: boolean;
  flush?: boolean;
  className?: string;
  id?: string;
}

const TONE_CLASS: Readonly<Record<NoticeTone, string>> = {
  info: s.info,
  success: s.success,
  warning: s.warning,
  danger: s.danger,
  neutral: s.neutral,
};

const TONE_ICON: Readonly<Record<NoticeTone, LucideIcon>> = {
  info: Info,
  success: CircleCheck,
  warning: TriangleAlert,
  danger: OctagonAlert,
  neutral: Info,
};

const DEFAULT_DISMISS_LABEL = 'Dismiss notice';

const InsideLiveNotice = createContext(false);

export function noticeRole(tone: NoticeTone, announce: NoticeAnnounce = false): NoticeRole | undefined {
  if (!announce) return undefined;
  if (announce === 'assertive') return 'alert';
  if (announce === 'polite') return 'status';
  return tone === 'danger' || tone === 'warning' ? 'alert' : 'status';
}

function hasContent(node: ReactNode): boolean {
  if (Array.isArray(node)) return node.some(hasContent);
  return node !== undefined && node !== null && node !== false && node !== true && node !== '';
}

export const Notice = forwardRef<HTMLDivElement, NoticeProps>(function Notice(
  {
    tone,
    title,
    children,
    meta,
    actions,
    onDismiss,
    dismissLabel,
    icon,
    announce = false,
    variant = 'banner',
    compact = false,
    flush = false,
    className,
    id,
  },
  ref,
) {
  const callout = variant === 'callout';
  const strip = compact && !callout;
  const insideLive = useContext(InsideLiveNotice);
  const role = insideLive ? undefined : noticeRole(tone, announce);
  const hasTitle = hasContent(title);
  const hasText = hasContent(children);
  const hasMeta = hasContent(meta);
  const hasActions = hasContent(actions);
  const dismissible = typeof onDismiss === 'function';
  const ToneIcon = TONE_ICON[tone] ?? Info;
  const glyph = icon === undefined ? <ToneIcon size={strip || callout ? 14 : 16} aria-hidden /> : icon;
  const showIcon = hasContent(glyph);
  const items = Array.isArray(meta) ? (meta as ReadonlyArray<ReactNode>).filter(hasContent) : null;
  const metaBody = items
    ? items.map((item, index) => <span key={index} className={s.metaItem}>{item}</span>)
    : meta;

  const classes = [
    s.notice,
    callout ? s.callout : s.banner,
    compact && s.compact,
    TONE_CLASS[tone] ?? s.neutral,
    dismissible && s.dismissible,
    strip && (hasActions || dismissible) && s.trailing,
    flush && s.flush,
    className,
  ].filter(Boolean).join(' ');

  const actionRow = hasActions ? <div className={s.actions}>{actions}</div> : null;
  const dismiss = dismissible ? (
    <button
      type="button"
      className={s.dismiss}
      aria-label={dismissLabel?.trim() || DEFAULT_DISMISS_LABEL}
      onClick={onDismiss}
    >
      <X size={14} aria-hidden />
    </button>
  ) : null;

  if (strip) {
    return (
      <div ref={ref} id={id} className={classes}>
        <div className={s.main}>
          <div className={s.line}>
            {showIcon ? <span className={s.icon} aria-hidden>{glyph}</span> : null}
            <div className={s.lineText}>
              {hasTitle || hasText ? (
                <span className={s.inline} role={role}>
                  <InsideLiveNotice.Provider value={insideLive || role !== undefined}>
                    {hasTitle ? <span className={s.inlineTitle}>{title}</span> : null}
                    {hasTitle && hasText ? ' ' : null}
                    {hasText ? children : null}
                  </InsideLiveNotice.Provider>
                </span>
              ) : null}
              {hasMeta && (hasTitle || hasText) ? ' ' : null}
              {hasMeta ? <span className={s.inlineMeta}>{metaBody}</span> : null}
            </div>
          </div>
          {actionRow}
        </div>
        {dismiss}
      </div>
    );
  }

  let heading: ReactNode = null;
  if (hasTitle && callout) {
    heading = (
      <div className={s.label}>
        {showIcon ? <span className={s.labelIcon} aria-hidden>{glyph}</span> : null}
        <span className={s.labelText}>{title}</span>
      </div>
    );
  } else if (hasTitle) {
    heading = <div className={s.title}>{title}</div>;
  }

  return (
    <div ref={ref} id={id} className={classes}>
      {!callout && showIcon ? <span className={s.icon} aria-hidden>{glyph}</span> : null}
      <div className={s.main}>
        {hasTitle || hasText ? (
          <div className={s.stack} role={role}>
            <InsideLiveNotice.Provider value={insideLive || role !== undefined}>
              {heading}
              {hasText ? <div className={callout ? s.calloutText : s.text}>{children}</div> : null}
            </InsideLiveNotice.Provider>
          </div>
        ) : null}
        {hasMeta ? <div className={[s.meta, items && s.metaList].filter(Boolean).join(' ')}>{metaBody}</div> : null}
        {actionRow}
      </div>
      {dismiss}
    </div>
  );
});
