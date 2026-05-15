import { HTMLAttributes, ReactNode, TableHTMLAttributes, TdHTMLAttributes, ThHTMLAttributes } from 'react';
import s from './Table.module.css';

export type TableDensity = 'default' | 'dense' | 'relaxed';

export interface TableProps extends TableHTMLAttributes<HTMLTableElement> {
  density?: TableDensity;
  
  flush?: boolean;
}

export function Table({ density = 'default', flush, className, children, ...rest }: TableProps) {
  const densityClass = density === 'dense' ? s.dense : density === 'relaxed' ? s.relaxed : '';
  return (
    <div className={[s.wrap, flush && s.wrapFlush].filter(Boolean).join(' ')}>
      <table className={[s.table, densityClass, className].filter(Boolean).join(' ')} {...rest}>
        {children}
      </table>
    </div>
  );
}

export function THead(props: HTMLAttributes<HTMLTableSectionElement>) {
  return <thead className={s.thead} {...props} />;
}
export function TBody(props: HTMLAttributes<HTMLTableSectionElement>) {
  return <tbody {...props} />;
}

type Align = 'left' | 'right' | 'center';

export interface ThProps extends ThHTMLAttributes<HTMLTableCellElement> {
  align?: Align;
}
export function Th({ align, className, ...rest }: ThProps) {
  const cls = [s.th, align === 'right' && s.numeric, align === 'center' && s.center, className].filter(Boolean).join(' ');
  return <th className={cls} {...rest} />;
}

export interface TdProps extends TdHTMLAttributes<HTMLTableCellElement> {
  align?: Align;
  
  emphasis?: 'primary' | 'secondary' | 'muted';
  
  mono?: boolean;
}
export function Td({ align, emphasis, mono, className, ...rest }: TdProps) {
  const cls = [
    s.td,
    align === 'right' && s.numeric,
    align === 'center' && s.center,
    emphasis === 'primary' && s.primary,
    emphasis === 'secondary' && s.secondary,
    emphasis === 'muted' && s.muted,
    mono && s.mono,
    className,
  ].filter(Boolean).join(' ');
  return <td className={cls} {...rest} />;
}

export interface TrProps extends HTMLAttributes<HTMLTableRowElement> {
  interactive?: boolean;
  selected?: boolean;
}
export function Tr({ interactive, selected, className, ...rest }: TrProps) {
  const cls = [s.tr, interactive && s.interactive, selected && s.selected, className].filter(Boolean).join(' ');
  return <tr className={cls} {...rest} />;
}

export interface TableEmptyProps {
  colSpan: number;
  children?: ReactNode;
}

export function TableEmpty({ colSpan, children }: TableEmptyProps) {
  return (
    <tr>
      <td colSpan={colSpan} className={s.empty}>{children ?? 'No data'}</td>
    </tr>
  );
}
