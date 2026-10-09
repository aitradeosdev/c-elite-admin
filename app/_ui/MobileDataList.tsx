'use client';

import {
  ForwardedRef, ReactNode, RefAttributes, forwardRef, useEffect, useId, useState,
} from 'react';
import Link from 'next/link';
import { ArrowDownWideNarrow, ArrowUpNarrowWide, Inbox } from 'lucide-react';
import { Button } from './Button';
import { Select } from './Field';
import { EmptyState, Skeleton } from './Misc';
import { ErrorState } from './States';
import { nextSort, sortWithKey, type SortState } from './useTableSort';
import s from './MobileDataList.module.css';

export type MobileDataListFlag = 'warning' | 'danger';

export interface MobileDataListRow {
  primary: ReactNode;
  secondary?: ReactNode;
  value?: ReactNode;
  status?: ReactNode;
  meta?: ReactNode;
  leading?: ReactNode;
  flag?: MobileDataListFlag | null;
  flagLabel?: string;
  href?: string;
  onClick?: () => void;
  actions?: ReactNode;
}

export interface MobileDataListEmpty {
  title: ReactNode;
  hint?: ReactNode;
  actions?: ReactNode;
  icon?: ReactNode;
}

export interface MobileDataListSortOption {
  key: string;
  label: string;
}

export interface MobileDataListProps<T> {
  items: readonly T[];
  getKey: (item: T) => string | number;
  renderRow: (item: T) => MobileDataListRow;
  ariaLabel: string;
  loading?: boolean;
  initialLoading?: boolean;
  busy?: boolean;
  error?: string | null;
  errorTitle?: string;
  refreshErrorTitle?: string;
  onRetry?: () => void;
  empty?: MobileDataListEmpty;
  skeletonRows?: number;
  sortOptions?: ReadonlyArray<MobileDataListSortOption>;
  sort?: SortState | null;
  onSortChange?: (next: SortState) => void;
  className?: string;
}

export type MobileDataListView = 'skeleton' | 'error' | 'empty' | 'list';

export interface MobileDataListViewInput {
  count: number;
  loading: boolean;
  error: boolean;
  settled: boolean;
  initialLoading?: boolean;
}

export function resolveMobileDataListView({
  count, loading, error, settled, initialLoading,
}: MobileDataListViewInput): MobileDataListView {
  if (count > 0) return 'list';
  if (initialLoading ?? (loading && !settled)) return 'skeleton';
  return error ? 'error' : 'empty';
}

const FLAG_LABELS: Record<MobileDataListFlag, string> = {
  warning: 'Flagged',
  danger: 'Flagged as critical',
};

const DEFAULT_EMPTY: MobileDataListEmpty = { title: 'Nothing to show' };

const SKELETON_SHAPES = [
  { primary: '58%', secondary: '36%', meta: '52%', value: 84, status: 56 },
  { primary: '44%', secondary: '48%', meta: '64%', value: 68, status: 64 },
  { primary: '66%', secondary: '30%', meta: '46%', value: 92, status: 52 },
  { primary: '51%', secondary: '42%', meta: '58%', value: 76, status: 60 },
  { primary: '62%', secondary: '34%', meta: '40%', value: 72, status: 58 },
  { primary: '47%', secondary: '45%', meta: '61%', value: 88, status: 50 },
];

function present(node: ReactNode): boolean {
  return node !== null && node !== undefined && typeof node !== 'boolean' && node !== '';
}

function Row({ row, id }: { row: MobileDataListRow; id: string }) {
  const hasValue = present(row.value);
  const hasLeading = present(row.leading);
  const interactive = Boolean(row.href || row.onClick);
  const bodyClass = [s.body, hasLeading && s.withLeading, interactive && s.interactive].filter(Boolean).join(' ');

  const content = (
    <>
      {row.flag ? <span className={s.srOnly}>{row.flagLabel ?? FLAG_LABELS[row.flag]}</span> : null}
      {hasLeading ? <span className={s.leading}>{row.leading}</span> : null}
      <span id={id} className={s.primary}>{row.primary}</span>
      {hasValue ? <span className={s.value}>{row.value}</span> : null}
      {present(row.secondary) ? <span className={s.secondary}>{row.secondary}</span> : null}
      {present(row.status) ? (
        <span className={[s.status, !hasValue && s.statusTop].filter(Boolean).join(' ')}>{row.status}</span>
      ) : null}
      {present(row.meta) ? <span className={s.meta}>{row.meta}</span> : null}
    </>
  );

  const body = row.href ? (
    <Link href={row.href} className={bodyClass} onClick={row.onClick}>{content}</Link>
  ) : row.onClick ? (
    <button type="button" className={bodyClass} onClick={row.onClick}>{content}</button>
  ) : (
    <div className={bodyClass}>{content}</div>
  );

  return (
    <li
      className={[
        s.row,
        row.flag === 'warning' && s.flagWarning,
        row.flag === 'danger' && s.flagDanger,
      ].filter(Boolean).join(' ')}
    >
      {body}
      {present(row.actions) ? (
        <div className={s.actions} role="group" aria-labelledby={id}>
          {row.actions}
        </div>
      ) : null}
    </li>
  );
}

function SkeletonRow({ index }: { index: number }) {
  const shape = SKELETON_SHAPES[index % SKELETON_SHAPES.length];
  return (
    <li className={s.row}>
      <div className={s.body}>
        <div className={[s.primary, s.placeholder].join(' ')}><Skeleton width={shape.primary} height="0.75em" /></div>
        <div className={[s.value, s.placeholder].join(' ')}><Skeleton width={shape.value} height="0.75em" /></div>
        <div className={[s.secondary, s.placeholder].join(' ')}><Skeleton width={shape.secondary} height="0.75em" /></div>
        <div className={[s.status, s.placeholder].join(' ')}><Skeleton width={shape.status} height="0.75em" /></div>
        <div className={[s.meta, s.placeholder].join(' ')}><Skeleton width={shape.meta} height="0.75em" /></div>
      </div>
    </li>
  );
}

interface SortBarProps {
  id: string;
  options: ReadonlyArray<MobileDataListSortOption>;
  sort: SortState | null;
  onChange: (next: SortState) => void;
}

function SortBar({ id, options, sort, onChange }: SortBarProps) {
  const listed = sort !== null && options.some((option) => option.key === sort.key);
  const descending = sort?.dir === 'desc';
  const Icon = descending ? ArrowDownWideNarrow : ArrowUpNarrowWide;
  return (
    <div className={s.sortBar}>
      <label className={s.sortLabel} htmlFor={id}>Sort by</label>
      <div className={s.sortField}>
        <Select
          id={id}
          value={listed && sort ? sort.key : ''}
          onChange={(event) => onChange(sortWithKey(sort, event.target.value))}
        >
          {listed ? null : <option value="" disabled>{sort ? 'Current order' : 'Default order'}</option>}
          {options.map((option) => <option key={option.key} value={option.key}>{option.label}</option>)}
        </Select>
      </div>
      <Button
        type="button"
        variant="secondary"
        iconOnly
        className={s.sortDirection}
        leftIcon={<Icon size={16} aria-hidden />}
        aria-label="Sort descending"
        aria-pressed={descending}
        disabled={!sort}
        onClick={() => {
          if (sort) onChange(nextSort(sort, sort.key));
        }}
      />
    </div>
  );
}

export const MobileDataList = forwardRef(function MobileDataList<T>(
  {
    items,
    getKey,
    renderRow,
    ariaLabel,
    loading = false,
    initialLoading,
    busy,
    error,
    errorTitle = 'This list could not be loaded',
    refreshErrorTitle = 'This list could not be refreshed',
    onRetry,
    empty,
    skeletonRows = 6,
    sortOptions,
    sort,
    onSortChange,
    className,
  }: MobileDataListProps<T>,
  ref: ForwardedRef<HTMLDivElement>,
) {
  const baseId = useId();
  const [settled, setSettled] = useState(!loading);

  useEffect(() => {
    if (!loading) setSettled(true);
  }, [loading]);

  const rootClass = [s.root, className].filter(Boolean).join(' ');
  const view = resolveMobileDataListView({
    count: items.length, loading, error: Boolean(error), settled, initialLoading,
  });
  const dimmed = busy ?? (loading && view !== 'list');
  const ariaBusy = loading || Boolean(busy) || undefined;
  const dim = (base?: string) => [base, dimmed && s.busy].filter(Boolean).join(' ') || undefined;
  const sortBar = sortOptions && sortOptions.length > 0 && onSortChange ? (
    <SortBar id={`${baseId}-sort`} options={sortOptions} sort={sort ?? null} onChange={onSortChange} />
  ) : null;

  if (view === 'skeleton') {
    const count = Math.max(1, Math.round(skeletonRows) || 0);
    return (
      <div ref={ref} className={rootClass}>
        {sortBar}
        <span className={s.srOnly} role="status">{`Loading ${ariaLabel}`}</span>
        <ul className={s.list} aria-hidden>
          {Array.from({ length: count }, (_, index) => <SkeletonRow key={index} index={index} />)}
        </ul>
      </div>
    );
  }

  if (view === 'error') {
    return (
      <div ref={ref} className={rootClass} aria-busy={ariaBusy}>
        {sortBar}
        <div className={dim(s.frame)}>
          <ErrorState compact title={errorTitle} message={error} onRetry={onRetry} />
        </div>
      </div>
    );
  }

  if (view === 'empty') {
    const state = empty ?? DEFAULT_EMPTY;
    return (
      <div ref={ref} className={rootClass} aria-busy={ariaBusy}>
        {sortBar}
        <EmptyState
          className={dim()}
          icon={state.icon === undefined ? <Inbox size={20} strokeWidth={1.75} aria-hidden /> : state.icon}
          title={state.title}
          hint={state.hint}
          actions={state.actions}
        />
      </div>
    );
  }

  return (
    <div ref={ref} className={rootClass}>
      {sortBar}
      {error ? (
        <div className={[s.frame, s.notice].join(' ')}>
          <ErrorState compact title={refreshErrorTitle} message={error} onRetry={onRetry} />
        </div>
      ) : null}
      <ul className={dim(s.list)} role="list" aria-label={ariaLabel} aria-busy={ariaBusy}>
        {items.map((item, index) => (
          <Row key={getKey(item)} row={renderRow(item)} id={`${baseId}-row-${index}`} />
        ))}
      </ul>
    </div>
  );
}) as <T>(props: MobileDataListProps<T> & RefAttributes<HTMLDivElement>) => ReactNode;
