'use client';

import {
  AnchorHTMLAttributes, ButtonHTMLAttributes, ForwardedRef, HTMLAttributes, MouseEvent, ReactNode,
  TableHTMLAttributes, TdHTMLAttributes, ThHTMLAttributes,
  createContext, forwardRef, useContext, useEffect, useMemo, useRef, useState,
} from 'react';
import Link, { type LinkProps } from 'next/link';
import { ChevronDown, ChevronUp, ChevronsUpDown, Inbox } from 'lucide-react';
import s from './Table.module.css';
import { EmptyState, Skeleton } from './Misc';
import type { SortState } from './useTableSort';

export type TableDensity = 'default' | 'dense' | 'relaxed';

export interface TableProps extends TableHTMLAttributes<HTMLTableElement> {
  density?: TableDensity;
  flush?: boolean;
  maxHeight?: number | string;
  busy?: boolean;
}

interface TableContextValue {
  label?: string;
}

const TableContext = createContext<TableContextValue>({});

function useScrollRegion() {
  const ref = useRef<HTMLDivElement>(null);
  const [scrollable, setScrollable] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const measure = () => {
      setScrollable(el.scrollHeight - el.clientHeight > 1 || el.scrollWidth - el.clientWidth > 1);
    };
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    if (el.firstElementChild) observer.observe(el.firstElementChild);
    return () => observer.disconnect();
  }, []);

  return [ref, scrollable] as const;
}

export const Table = forwardRef<HTMLTableElement, TableProps>(function Table(
  { density = 'default', flush, maxHeight, busy, className, children, 'aria-busy': ariaBusy, ...rest }, ref,
) {
  const [wrapRef, scrollable] = useScrollRegion();
  const scroll = maxHeight !== undefined;
  const label = rest['aria-label'];
  const labelledBy = rest['aria-labelledby'];
  const region = scrollable && Boolean(label || labelledBy);
  const densityClass = density === 'dense' ? s.dense : density === 'relaxed' ? s.relaxed : '';
  const context = useMemo<TableContextValue>(() => ({ label }), [label]);
  return (
    <TableContext.Provider value={context}>
      <div
        ref={wrapRef}
        className={[s.wrap, flush && s.wrapFlush, scroll && s.scroll].filter(Boolean).join(' ')}
        style={scroll ? { maxHeight } : undefined}
        tabIndex={scrollable ? 0 : undefined}
        role={region ? 'region' : undefined}
        aria-label={region ? label : undefined}
        aria-labelledby={region ? labelledBy : undefined}
      >
        <table
          ref={ref}
          className={[s.table, densityClass, busy && s.busy, className].filter(Boolean).join(' ')}
          {...rest}
          aria-busy={busy ? true : ariaBusy}
        >
          {children}
        </table>
      </div>
    </TableContext.Provider>
  );
});

export type TableSectionProps = HTMLAttributes<HTMLTableSectionElement>;

export const THead = forwardRef<HTMLTableSectionElement, TableSectionProps>(function THead(
  { className, ...rest }, ref,
) {
  return <thead ref={ref} className={[s.thead, className].filter(Boolean).join(' ')} {...rest} />;
});

export const TBody = forwardRef<HTMLTableSectionElement, TableSectionProps>(function TBody(props, ref) {
  return <tbody ref={ref} {...props} />;
});

type Align = 'left' | 'right' | 'center';

export interface ThProps extends ThHTMLAttributes<HTMLTableCellElement> {
  align?: Align;
  sticky?: boolean;
  sortKey?: string;
  sort?: SortState | null;
  onSort?: (key: string) => void;
}

export const Th = forwardRef<HTMLTableCellElement, ThProps>(function Th(
  { align, sticky, sortKey, sort, onSort, className, children, ...rest }, ref,
) {
  const sortable = Boolean(sortKey && onSort);
  const dir = sortable && sort && sort.key === sortKey ? sort.dir : null;
  const cls = [
    s.th,
    align === 'right' && s.numeric,
    align === 'center' && s.center,
    sticky && s.sticky,
    sortable && s.sortable,
    dir && s.sorted,
    className,
  ].filter(Boolean).join(' ');

  if (!sortKey || !onSort) {
    return <th ref={ref} className={cls} {...rest}>{children}</th>;
  }

  const Icon = dir === 'asc' ? ChevronUp : dir === 'desc' ? ChevronDown : ChevronsUpDown;
  return (
    <th
      ref={ref}
      {...rest}
      className={cls}
      aria-sort={dir === 'asc' ? 'ascending' : dir === 'desc' ? 'descending' : 'none'}
    >
      <button type="button" className={s.sortButton} onClick={() => onSort(sortKey)}>
        <span>{children}</span>
        <Icon className={s.sortIcon} size={14} strokeWidth={2} aria-hidden />
      </button>
    </th>
  );
});

export interface TdProps extends TdHTMLAttributes<HTMLTableCellElement> {
  align?: Align;
  emphasis?: 'primary' | 'secondary' | 'muted';
  mono?: boolean;
  sticky?: boolean;
}

export const Td = forwardRef<HTMLTableCellElement, TdProps>(function Td(
  { align, emphasis, mono, sticky, className, ...rest }, ref,
) {
  const cls = [
    s.td,
    align === 'right' && s.numeric,
    align === 'center' && s.center,
    emphasis === 'primary' && s.primary,
    emphasis === 'secondary' && s.secondary,
    emphasis === 'muted' && s.muted,
    mono && s.mono,
    sticky && s.sticky,
    className,
  ].filter(Boolean).join(' ');
  return <td ref={ref} className={cls} {...rest} />;
});

export const ROW_ACTIVATION_IGNORE = [
  'a',
  'button',
  'input',
  'select',
  'textarea',
  'label',
  'summary',
  'dialog',
  '[role="button"]',
  '[role="link"]',
  '[role="checkbox"]',
  '[role="radio"]',
  '[role="switch"]',
  '[role="tab"]',
  '[role="menuitem"]',
  '[role="menuitemcheckbox"]',
  '[role="menuitemradio"]',
  '[role="option"]',
  '[role="combobox"]',
  '[role="textbox"]',
  '[role="slider"]',
  '[role="spinbutton"]',
  '[role="menu"]',
  '[role="listbox"]',
  '[role="dialog"]',
  '[role="alertdialog"]',
  '[data-row-ignore]',
].join(', ');

export interface RowActivationEvent {
  button: number;
  altKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  defaultPrevented: boolean;
  target: EventTarget | null;
  currentTarget: EventTarget | null;
}

export interface RowActivationSelection {
  readonly isCollapsed: boolean;
  readonly anchorNode: Node | null;
  readonly focusNode: Node | null;
  toString(): string;
  containsNode?(node: Node, allowPartialContainment?: boolean): boolean;
}

function elementOf(target: EventTarget | null): Element | null {
  if (!target) return null;
  if (typeof (target as Element).closest === 'function') return target as Element;
  return (target as Node).parentElement ?? null;
}

function documentSelection(row: Element | null): RowActivationSelection | null {
  return row?.ownerDocument?.getSelection?.() ?? null;
}

function selectionWithin(selection: RowActivationSelection, row: Element): boolean {
  if (selection.isCollapsed || selection.toString() === '') return false;
  if (row.contains(selection.anchorNode) || row.contains(selection.focusNode)) return true;
  return Boolean(selection.containsNode?.(row, true));
}

export function shouldActivateRow(
  event: RowActivationEvent,
  selection?: RowActivationSelection | null,
): boolean {
  if (event.defaultPrevented || event.button !== 0) return false;
  if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return false;
  const row = elementOf(event.currentTarget);
  const target = elementOf(event.target);
  if (row && target && !row.contains(target)) return false;
  const hit = target?.closest(ROW_ACTIVATION_IGNORE) ?? null;
  if (hit && hit !== row && (!row || row.contains(hit))) return false;
  const current = selection === undefined ? documentSelection(row) : selection;
  if (current && row && selectionWithin(current, row)) return false;
  return true;
}

export interface TrProps extends HTMLAttributes<HTMLTableRowElement> {
  interactive?: boolean;
  selected?: boolean;
  onActivate?: (event: MouseEvent<HTMLTableRowElement>) => void;
}

export const Tr = forwardRef<HTMLTableRowElement, TrProps>(function Tr(
  { interactive, selected, onActivate, onClick, className, ...rest }, ref,
) {
  const clickable = interactive ?? Boolean(onActivate);
  const cls = [s.tr, clickable && s.interactive, selected && s.selected, className].filter(Boolean).join(' ');
  const handleClick = onActivate
    ? (event: MouseEvent<HTMLTableRowElement>) => {
        onClick?.(event);
        if (shouldActivateRow(event)) onActivate(event);
      }
    : onClick;
  return <tr ref={ref} className={cls} onClick={handleClick} {...rest} />;
});

interface RowOpenOwnProps {
  children: ReactNode;
  className?: string;
  'aria-label'?: string;
}

export interface RowOpenLinkProps
  extends RowOpenOwnProps, Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'href' | 'children' | 'className' | 'aria-label'> {
  href: string;
  prefetch?: LinkProps['prefetch'];
  replace?: boolean;
  scroll?: boolean;
}

export interface RowOpenButtonProps
  extends RowOpenOwnProps, Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'type' | 'onClick' | 'children' | 'className' | 'aria-label'> {
  href?: undefined;
  onClick: (event: MouseEvent<HTMLButtonElement>) => void;
}

export type RowOpenProps = RowOpenLinkProps | RowOpenButtonProps;

export const RowOpen = forwardRef<HTMLAnchorElement | HTMLButtonElement, RowOpenProps>(function RowOpen(props, ref) {
  if (props.href !== undefined) {
    const { className, children, ...rest } = props;
    return (
      <Link
        ref={ref as ForwardedRef<HTMLAnchorElement>}
        {...rest}
        className={[s.rowOpen, className].filter(Boolean).join(' ')}
      >
        {children}
      </Link>
    );
  }
  const { className, children, ...rest } = props;
  return (
    <button
      ref={ref as ForwardedRef<HTMLButtonElement>}
      {...rest}
      type="button"
      className={[s.rowOpen, className].filter(Boolean).join(' ')}
    >
      {children}
    </button>
  );
});

export interface TableEmptyProps {
  colSpan: number;
  children?: ReactNode;
  title?: ReactNode;
  hint?: ReactNode;
  actions?: ReactNode;
  icon?: ReactNode;
  className?: string;
}

export function TableEmpty({ colSpan, children, title, hint, actions, icon, className }: TableEmptyProps) {
  const structured = title !== undefined || hint !== undefined || actions !== undefined || icon !== undefined;
  if (!structured) {
    return (
      <tr>
        <td colSpan={colSpan} className={[s.empty, className].filter(Boolean).join(' ')}>{children ?? 'No data'}</td>
      </tr>
    );
  }
  return (
    <tr>
      <td colSpan={colSpan} className={[s.stateCell, className].filter(Boolean).join(' ')}>
        <EmptyState
          className={s.emptyState}
          icon={icon === undefined ? <Inbox size={20} strokeWidth={1.75} aria-hidden /> : icon}
          title={title ?? children ?? 'No data'}
          hint={hint}
          actions={actions}
        />
      </td>
    </tr>
  );
}

export interface TableStateProps {
  colSpan: number;
  children: ReactNode;
  className?: string;
}

export function TableState({ colSpan, children, className }: TableStateProps) {
  return (
    <tr>
      <td colSpan={colSpan} className={[s.stateCell, className].filter(Boolean).join(' ')}>{children}</td>
    </tr>
  );
}

export interface TableSkeletonColumn {
  width?: number | string;
  align?: Align;
  lines?: 1 | 2;
  avatar?: boolean;
  button?: boolean;
}

export interface TableSkeletonProps {
  colSpan?: number;
  rows?: number;
  columns?: ReadonlyArray<TableSkeletonColumn>;
  label?: string;
}

const ROW_WIDTHS = ['86%', '68%', '93%', '58%', '76%', '64%', '88%', '71%'];
const COLUMN_WIDTHS = [112, 96, 128, 84, 104, 72, 120, 90];
const ROW_FACTORS = [1, 0.82, 0.94, 0.7, 0.88, 0.76, 0.97, 0.8];
const SECOND_LINE = 0.62;
const BUTTON_WIDTH = 56;

function scaled(width: number | string, factor: number): number | string {
  if (typeof width === 'number') return Math.round(width * factor);
  const rounded = Math.round(factor * 1000) / 1000;
  return rounded === 1 ? width : `calc(${width} * ${rounded})`;
}

function alignClass(align: Align | undefined): string | false {
  return align === 'right' ? s.skeletonEnd : align === 'center' ? s.skeletonCenter : false;
}

function SkeletonCell({ column, index, row }: { column: TableSkeletonColumn; index: number; row: number }) {
  const factor = ROW_FACTORS[(row + index) % ROW_FACTORS.length];
  const width = column.width ?? (column.button ? BUTTON_WIDTH : COLUMN_WIDTHS[index % COLUMN_WIDTHS.length]);
  const cellClass = [
    s.td,
    s.skeletonCell,
    column.align === 'right' && s.numeric,
    column.align === 'center' && s.center,
  ].filter(Boolean).join(' ');
  const contentClass = [s.skeletonContent, alignClass(column.align)].filter(Boolean).join(' ');

  if (column.button) {
    return (
      <td className={cellClass}>
        <div className={contentClass}>
          <Skeleton className={s.skeletonButton} width={width} height="var(--space-7)" />
        </div>
      </td>
    );
  }

  return (
    <td className={cellClass}>
      <div className={contentClass}>
        {column.avatar ? (
          <Skeleton className={s.skeletonAvatar} width="var(--space-7)" height="var(--space-7)" rounded />
        ) : null}
        <div className={s.skeletonLines}>
          <div className={s.skeletonLine}>
            <Skeleton width={scaled(width, factor)} height="0.75em" />
          </div>
          {column.lines === 2 ? (
            <div className={[s.skeletonLine, s.skeletonLineSub].join(' ')}>
              <Skeleton width={scaled(width, factor * SECOND_LINE)} height="0.75em" />
            </div>
          ) : null}
        </div>
      </div>
    </td>
  );
}

function tableSkeletonMessage(label: string | undefined, tableLabel: string | undefined): string {
  if (label !== undefined && label.trim() !== '') return label;
  const name = tableLabel?.trim();
  if (!name) return 'Loading';
  return /^loading\b/i.test(name) ? name : `Loading ${name}`;
}

export function TableSkeleton({ colSpan, rows = 6, columns, label }: TableSkeletonProps) {
  const table = useContext(TableContext);
  const span = colSpan ?? (columns && columns.length > 0 ? columns.length : 1);
  const message = tableSkeletonMessage(label, table.label);
  return (
    <>
      <tr>
        <td colSpan={span} className={s.srOnly}>
          <span role="status">{message}</span>
        </td>
      </tr>
      {Array.from({ length: rows }, (_, row) => (
        <tr key={row} className={s.skeletonRow} aria-hidden>
          {columns && columns.length > 0 ? (
            columns.map((column, index) => <SkeletonCell key={index} column={column} index={index} row={row} />)
          ) : (
            <td colSpan={span} className={[s.td, s.skeletonCell].join(' ')}>
              <div className={s.skeletonLine}>
                <Skeleton width={ROW_WIDTHS[row % ROW_WIDTHS.length]} height="0.75em" />
              </div>
            </td>
          )}
        </tr>
      ))}
    </>
  );
}
