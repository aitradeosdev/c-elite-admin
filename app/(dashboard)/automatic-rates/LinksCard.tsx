'use client';

import { useId, useMemo, useState, type ReactNode } from 'react';
import { ChevronDown } from 'lucide-react';
import {
  Badge, Button, Card, CardBody, CardHeader, FilterBar, MobileDataList, Notice, SearchInput, Select, StatStrip,
  TBody, THead, Table, Td, Th, Tr,
  type StatItem,
} from '../../_ui';
import { BrandMark } from '../rates/RateParts';
import { formatPct, unpricedReasonText } from './rules';
import {
  LINK_FILTERS, filterLinkCards, filtering,
  type CardsSnapshot, type LinkCard, type LinkFilter, type LinkRow,
} from './model';
import s from './page.module.css';

export interface LinksCardProps {
  snapshot: CardsSnapshot;
  provider: string;
  lock: string | null;
  canWrite: boolean;
  isMobile: boolean;
  disabled: boolean;
  loadingProducts: boolean;
  headingId: string;
  onLink: (row: LinkRow, card: LinkCard) => void;
  onUnlink: (row: LinkRow, card: LinkCard) => void;
  onExtra: (card: LinkCard) => void;
  onLoadProducts: () => void;
}

interface RowActions {
  canLink: boolean;
  canWrite: boolean;
  disabled: boolean;
  onLink: (row: LinkRow) => void;
  onUnlink: (row: LinkRow) => void;
}

function count(value: number, one: string, many: string): string {
  return `${value.toLocaleString('en-NG')} ${value === 1 ? one : many}`;
}

function extraLine(card: LinkCard): string {
  return card.ownPct === null
    ? `Extra percentage: every-card percentage (${formatPct(card.effectivePct)})`
    : `Extra percentage: ${formatPct(card.ownPct)} for this card`;
}

function RowBadges({ row, provider }: { row: LinkRow; provider: string }) {
  if (row.ref === null) return null;
  const badges: ReactNode[] = [];
  if (!row.product || !row.product.inLatest) {
    badges.push(<Badge key="latest" tone="warning">Not in {provider}’s latest list</Badge>);
  }
  if (row.product?.problem) badges.push(<Badge key="usable" tone="warning">Rates not usable</Badge>);
  if (row.offReason !== null) {
    badges.push(
      <Badge key="off" tone="danger" className={s.longBadge}>
        Switched off at the last update: {unpricedReasonText(row.offReason)}
      </Badge>,
    );
  }
  return badges.length > 0 ? <span className={s.badges}>{badges}</span> : null;
}

function ProductCell({ row }: { row: LinkRow }) {
  if (row.ref === null) return <span className={s.muted}>Not linked</span>;
  return (
    <span className={s.product}>
      <span className={s.productName}>{row.product ? row.product.name : row.ref}</span>
      <span className={s.productRef}>{row.ref}</span>
    </span>
  );
}

function Actions({ row, actions }: { row: LinkRow; actions: RowActions }) {
  if (!actions.canWrite) return null;
  if (row.ref === null) {
    if (!actions.canLink) return null;
    return (
      <Button type="button" variant="secondary" size="sm" disabled={actions.disabled} aria-label={`Link ${row.title}`} onClick={() => actions.onLink(row)}>
        Link…
      </Button>
    );
  }
  return (
    <span className={s.rowActions}>
      {actions.canLink ? (
        <Button type="button" variant="ghost" size="sm" disabled={actions.disabled} aria-label={`Change the product for ${row.title}`} onClick={() => actions.onLink(row)}>
          Change…
        </Button>
      ) : null}
      <Button type="button" variant="ghost" size="sm" disabled={actions.disabled} aria-label={`Unlink ${row.title}`} onClick={() => actions.onUnlink(row)}>
        Unlink…
      </Button>
    </span>
  );
}

function DesktopRows({ card, provider, actions }: { card: LinkCard; provider: string; actions: RowActions }) {
  const withActions = actions.canWrite;
  return (
    <Table density="dense" aria-label={`${card.name} card types`}>
      <THead>
        <Tr>
          <Th>Card type</Th>
          <Th>Provider product</Th>
          {withActions ? (
            <Th align="right" className={s.actionsCol}>
              <span className={s.srOnly}>Actions</span>
            </Th>
          ) : null}
        </Tr>
      </THead>
      <TBody>
        {card.rows.map((row) => (
          <Tr key={row.typeId}>
            <Td>
              <span className={s.typeCell}>
                <span className={s.typeName}>{row.place}</span>
                <span className={s.typeMeta}>{count(row.liveRanges, 'live range', 'live ranges')}</span>
              </span>
            </Td>
            <Td>
              <span className={s.productCell}>
                <ProductCell row={row} />
                <RowBadges row={row} provider={provider} />
              </span>
            </Td>
            {withActions ? (
              <Td align="right" className={s.actionsCol}>
                <Actions row={row} actions={actions} />
              </Td>
            ) : null}
          </Tr>
        ))}
      </TBody>
    </Table>
  );
}

function MobileRows({ card, provider, actions }: { card: LinkCard; provider: string; actions: RowActions }) {
  return (
    <MobileDataList<LinkRow>
      ariaLabel={`${card.name} card types`}
      items={card.rows}
      getKey={(row) => row.typeId}
      renderRow={(row) => ({
        primary: row.place,
        secondary: <ProductCell row={row} />,
        meta: count(row.liveRanges, 'live range', 'live ranges'),
        status: <RowBadges row={row} provider={provider} />,
        flag: row.offReason !== null ? 'danger' : null,
        flagLabel: row.offReason !== null ? `Switched off at the last update: ${unpricedReasonText(row.offReason)}` : undefined,
        actions: actions.canWrite ? <Actions row={row} actions={actions} /> : undefined,
      })}
    />
  );
}

interface CardSectionProps {
  card: LinkCard;
  full: LinkCard;
  expanded: boolean;
  provider: string;
  isMobile: boolean;
  actions: RowActions;
  onToggle: (id: string) => void;
  onExtra: (card: LinkCard) => void;
}

function LinkCardSection({ card, full, expanded, provider, isMobile, actions, onToggle, onExtra }: CardSectionProps) {
  const bodyId = useId();
  const off = full.rows.filter((row) => row.offReason !== null).length;
  return (
    <div className={s.brand}>
      <h3 className={s.brandHeading}>
        <button
          type="button"
          className={s.brandToggle}
          aria-expanded={expanded}
          aria-controls={expanded ? bodyId : undefined}
          onClick={() => onToggle(card.id)}
        >
          <BrandMark src={card.logoUrl} name={card.name} />
          <span className={s.brandTitle}>
            <span className={s.brandName}>{card.name}</span>
            <span className={s.brandMeta}>
              {`${count(full.rows.length, 'card type', 'card types')} · ${full.linked.toLocaleString('en-NG')} linked`}
            </span>
          </span>
          <span className={s.brandBadges}>
            {off > 0 ? <Badge tone="danger">{off.toLocaleString('en-NG')} switched off</Badge> : null}
          </span>
          <ChevronDown size={16} aria-hidden className={expanded ? `${s.chevron} ${s.chevronOpen}` : s.chevron} />
        </button>
      </h3>
      {expanded ? (
        <div id={bodyId} className={s.brandBody}>
          <div className={s.extraLine}>
            <span>{extraLine(full)}</span>
            {actions.canWrite ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={actions.disabled}
                aria-label={`Change the extra percentage for ${full.name}`}
                onClick={() => onExtra(full)}
              >
                Change…
              </Button>
            ) : null}
          </div>
          {card.rows.length === 0 ? (
            <p className={s.emptyNote}>This card has no active card types yet.</p>
          ) : isMobile ? (
            <MobileRows card={card} provider={provider} actions={actions} />
          ) : (
            <DesktopRows card={card} provider={provider} actions={actions} />
          )}
        </div>
      ) : null}
    </div>
  );
}

export function LinksCard({
  snapshot, provider, lock, canWrite, isMobile, disabled, loadingProducts, headingId, onLink, onUnlink, onExtra, onLoadProducts,
}: LinksCardProps) {
  const [open, setOpen] = useState<ReadonlySet<string>>(
    () => new Set(snapshot.cards.length === 1 ? [snapshot.cards[0].id] : []),
  );
  const [searchText, setSearchText] = useState('');
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<LinkFilter>('all');
  const visible = useMemo(() => filterLinkCards(snapshot.cards, query, filter), [snapshot.cards, query, filter]);
  const fullCards = useMemo(() => new Map(snapshot.cards.map((card) => [card.id, card])), [snapshot.cards]);
  const filtered = filtering(query, filter) || searchText.trim() !== '';

  const onToggle = (id: string) => {
    setOpen((previous) => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const openMatching = (nextQuery: string, nextFilter: LinkFilter) => {
    if (!filtering(nextQuery, nextFilter)) return;
    const matches = filterLinkCards(snapshot.cards, nextQuery, nextFilter).map((card) => card.id);
    setOpen((previous) => new Set([...previous, ...matches]));
  };

  const onQuery = (value: string) => {
    setQuery(value);
    openMatching(value, filter);
  };

  const onFilter = (next: LinkFilter) => {
    setFilter(next);
    openMatching(query, next);
  };

  const onClear = () => {
    setSearchText('');
    setQuery('');
    setFilter('all');
  };

  const usable = snapshot.products.filter((product) => product.bands !== null).length;
  const stats: StatItem[] = [
    { label: 'Linked', value: snapshot.linkedCount.toLocaleString('en-NG') },
    { label: 'Not linked', value: (snapshot.typeCount - snapshot.linkedCount).toLocaleString('en-NG') },
    {
      label: 'Switched off at the last update',
      value: snapshot.offCount.toLocaleString('en-NG'),
      tone: snapshot.offCount > 0 ? 'danger' : undefined,
    },
    { label: 'Products', value: snapshot.products.length.toLocaleString('en-NG'), hint: `${usable.toLocaleString('en-NG')} usable` },
  ];
  const noProvider = snapshot.provider === null;
  const noProducts = !noProvider && snapshot.products.length === 0;
  const actionsFor = (card: LinkCard): RowActions => ({
    canLink: !noProvider && !noProducts,
    canWrite,
    disabled,
    onLink: (row) => onLink(row, card),
    onUnlink: (row) => onUnlink(row, card),
  });

  return (
    <Card role="region" aria-labelledby={headingId}>
      <CardHeader
        title={<h2 id={headingId} className={s.heading}>Card types</h2>}
        subtitle={`Link each card type to the matching ${provider} product. While automatic rates are on, linked card types get that product’s ranges and rates; the rest stay manual.`}
      />
      <CardBody className={s.stack}>
        {lock !== null ? <Notice variant="callout" tone="neutral">{lock}</Notice> : null}
        {lock === null && noProvider ? (
          <Notice variant="callout" tone="neutral" title="Choose a rate provider first">
            Pick the provider in Update settings, then load its products to start linking card types.
          </Notice>
        ) : null}
        {lock === null && noProducts ? (
          <Notice
            variant="callout"
            tone="neutral"
            title="No products loaded yet"
            actions={canWrite ? (
              <Button type="button" variant="secondary" size="sm" loading={loadingProducts} disabled={disabled} onClick={onLoadProducts}>
                Load products
              </Button>
            ) : undefined}
          >
            Load the product list from {provider} to start linking card types.
          </Notice>
        ) : null}
        <StatStrip aria-label="Card type links" items={stats} />
        {snapshot.cards.length > 0 ? (
          <FilterBar
            aria-label="Filter card types"
            search={(
              <SearchInput
                aria-label="Search card types"
                placeholder="Card, country or type"
                value={searchText}
                onChange={setSearchText}
                onDebouncedChange={onQuery}
              />
            )}
            filters={(
              <Select inline aria-label="Show" value={filter} onChange={(event) => onFilter(event.target.value as LinkFilter)}>
                {LINK_FILTERS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
              </Select>
            )}
            onClear={onClear}
            active={filtered}
          />
        ) : null}
        {snapshot.cards.length === 0 ? (
          <p className={s.emptyNote}>There are no active cards yet. Add a card, or switch one on, in Cards.</p>
        ) : visible.length === 0 ? (
          <div className={s.emptyFilter}>
            <p className={s.emptyNote}>No card types match these filters.</p>
            <Button type="button" variant="secondary" size="sm" onClick={onClear}>Clear filters</Button>
          </div>
        ) : (
          <div className={s.brandList}>
            {visible.map((card) => {
              const full = fullCards.get(card.id);
              return full ? (
                <LinkCardSection
                  key={card.id}
                  card={card}
                  full={full}
                  expanded={open.has(card.id)}
                  provider={provider}
                  isMobile={isMobile}
                  actions={actionsFor(full)}
                  onToggle={onToggle}
                  onExtra={onExtra}
                />
              ) : null;
            })}
          </div>
        )}
        {snapshot.hiddenLinked > 0 ? (
          <p className={s.note}>
            {snapshot.hiddenLinked === 1
              ? '1 linked card type is switched off in Cards, so it is not listed here. It is still updated.'
              : `${snapshot.hiddenLinked.toLocaleString('en-NG')} linked card types are switched off in Cards, so they are not listed here. They are still updated.`}
          </p>
        ) : null}
      </CardBody>
    </Card>
  );
}
