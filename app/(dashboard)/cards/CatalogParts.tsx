'use client';

import { useCallback, useEffect, useState, type ReactNode } from 'react';
import {
  ArrowDown, ArrowDownToLine, ArrowRight, ArrowUp, ArrowUpToLine, Globe, MoreHorizontal, Pencil, Power, PowerOff,
} from 'lucide-react';
import { Avatar, Badge, Button, Menu, Spinner, StatusDot, type AvatarSize, type MenuEntryInput } from '../../_ui';
import { flagOf } from './countries';
import {
  availabilityText, brandLabel, canMove, countrySummary, needsCountry, statusText,
  type CatalogCard, type MoveTarget,
} from './model';
import s from './page.module.css';

export function BrandMark({ src, name, size = 'sm' }: { src: string | null; name: string; size?: AvatarSize }) {
  return <Avatar src={src} name={name || '?'} size={size} decorative className={s.logoTile} />;
}

export function Flag({ code }: { code: string }) {
  return <span className={s.flag} aria-hidden>{flagOf(code)}</span>;
}

export function BrandStatus({ card }: { card: Pick<CatalogCard, 'is_active' | 'countries'> }) {
  return (
    <span className={s.statusCell}>
      <StatusDot status={card.is_active ? 'active' : 'inactive'} label={statusText(card.is_active)} />
      {needsCountry(card) ? <Badge tone="warning">No available country</Badge> : null}
    </span>
  );
}

export function AvailabilityDot({ active }: { active: boolean }) {
  return <StatusDot status={active ? 'active' : 'inactive'} label={availabilityText(active)} />;
}

export function CountryCell({ card }: { card: Pick<CatalogCard, 'countries'> }) {
  const summary = countrySummary(card.countries);
  return (
    <div className={s.stack}>
      <span className={s.lead}>
        {summary.count}
        {summary.unavailable > 0 ? <span className={s.muted}>{` · ${summary.unavailable} unavailable`}</span> : null}
      </span>
      {summary.names ? <span className={s.sub}>{summary.names}</span> : null}
    </div>
  );
}

export function countryText(card: Pick<CatalogCard, 'countries'>): string {
  const summary = countrySummary(card.countries);
  const unavailable = summary.unavailable > 0 ? ` · ${summary.unavailable} unavailable` : '';
  return summary.names ? `${summary.count}${unavailable} · ${summary.names}` : `${summary.count}${unavailable}`;
}

export interface MoveControlsProps {
  card: Pick<CatalogCard, 'id' | 'name'>;
  index: number;
  total: number;
  saving: boolean;
  locked: boolean;
  showPosition?: boolean;
  onMove: (target: MoveTarget) => void;
}

export function MoveControls({ card, index, total, saving, locked, showPosition = true, onMove }: MoveControlsProps) {
  const label = brandLabel(card);
  const control = (target: 'up' | 'down', icon: ReactNode) => {
    const unavailable = locked || !canMove(index, total, target);
    return (
      <Button
        type="button"
        variant="ghost"
        size="sm"
        iconOnly
        leftIcon={icon}
        aria-label={`Move ${label} ${target}`}
        aria-disabled={unavailable || undefined}
        data-move={card.id}
        data-move-dir={target}
        onClick={() => {
          if (!unavailable) onMove(target);
        }}
      />
    );
  };
  return (
    <span className={s.moves}>
      {showPosition || saving ? (
        <span className={s.position}>
          {saving ? (
            <>
              <span aria-hidden className={s.positionSpinner}><Spinner size={12} /></span>
              <span className={s.srOnly}>Saving the new order</span>
            </>
          ) : (
            index + 1
          )}
        </span>
      ) : null}
      {control('up', <ArrowUp size={14} aria-hidden />)}
      {control('down', <ArrowDown size={14} aria-hidden />)}
    </span>
  );
}

export interface BrandMenuProps {
  card: CatalogCard;
  index: number;
  total: number;
  locked: boolean;
  canReorder: boolean;
  onEdit: () => void;
  onCountries: () => void;
  onMove: (target: MoveTarget) => void;
  onStatus: (next: boolean) => void;
}

export function BrandMenu({
  card, index, total, locked, canReorder, onEdit, onCountries, onMove, onStatus,
}: BrandMenuProps) {
  const label = brandLabel(card);
  const items: MenuEntryInput[] = [
    { label: 'Edit brand', icon: <Pencil size={14} aria-hidden />, disabled: locked, onSelect: onEdit },
    { label: 'Manage countries', icon: <Globe size={14} aria-hidden />, onSelect: onCountries },
    canReorder ? { type: 'separator' } : null,
    canReorder
      ? {
          label: 'Move to top',
          icon: <ArrowUpToLine size={14} aria-hidden />,
          disabled: locked || !canMove(index, total, 'top'),
          onSelect: () => onMove('top'),
        }
      : null,
    canReorder
      ? {
          label: 'Move to bottom',
          icon: <ArrowDownToLine size={14} aria-hidden />,
          disabled: locked || !canMove(index, total, 'bottom'),
          onSelect: () => onMove('bottom'),
        }
      : null,
    { type: 'separator' },
    card.is_active
      ? {
          label: 'Deactivate brand',
          icon: <PowerOff size={14} aria-hidden />,
          danger: true,
          disabled: locked,
          onSelect: () => onStatus(false),
        }
      : {
          label: 'Activate brand',
          icon: <Power size={14} aria-hidden />,
          disabled: locked,
          onSelect: () => onStatus(true),
        },
  ];
  return (
    <Menu
      align="end"
      aria-label={`Actions for ${label}`}
      items={items}
      trigger={(props) => (
        <Button
          {...props}
          type="button"
          variant="ghost"
          size="sm"
          iconOnly
          leftIcon={<MoreHorizontal size={16} aria-hidden />}
          aria-label={`More actions for ${label}`}
          data-row-menu={card.id}
        />
      )}
    />
  );
}

export function ValueDiff({ before, after }: { before: ReactNode; after: ReactNode }) {
  return (
    <span className={s.diff}>
      <span className={s.srOnly}>Changes from </span>
      <span className={s.diffBefore}>{before}</span>
      <ArrowRight size={12} aria-hidden className={s.diffArrow} />
      <span className={s.srOnly}> to </span>
      <span className={s.diffAfter}>{after}</span>
    </span>
  );
}

export function LogoValue({ src, name }: { src: string | null; name: string }) {
  if (!src) return <span className={s.muted}>No logo</span>;
  return (
    <span className={s.logoValue}>
      <BrandMark src={src} name={name} size="md" />
      <span className={s.srOnly}>Logo image</span>
    </span>
  );
}

function takesFocus(element: Element | null): element is HTMLElement {
  return element instanceof HTMLElement && element.isConnected && element.getClientRects().length > 0;
}

export function visibleTarget(selector: string, root?: ParentNode | null): HTMLElement | null {
  const scope = root ?? (typeof document === 'undefined' ? null : document);
  if (!scope) return null;
  return Array.from(scope.querySelectorAll(selector)).find(takesFocus) ?? null;
}

export function useDeferredFocus(): (find: () => HTMLElement | null, force?: boolean) => void {
  const [request, setRequest] = useState<{ find: () => HTMLElement | null; force: boolean } | null>(null);
  useEffect(() => {
    if (!request) return;
    const target = request.find();
    if (!target || !target.isConnected) return;
    const active = target.ownerDocument.activeElement;
    if (!request.force && active && active !== target.ownerDocument.body && active !== target) return;
    target.focus({ preventScroll: true });
  }, [request]);
  return useCallback(
    (find: () => HTMLElement | null, force = false) => setRequest({ find, force }),
    [],
  );
}

export function useLeaveWarning(active: boolean) {
  useEffect(() => {
    if (!active) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [active]);
}
