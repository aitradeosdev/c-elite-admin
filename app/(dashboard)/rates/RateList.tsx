'use client';

import { useId } from 'react';
import { ChevronDown, Plus, Undo2 } from 'lucide-react';
import {
  Badge, Button, FieldShell, Input, MobileDataList, Money, StatusDot, TBody, THead, Table, TableEmpty, Td, Th, Toggle,
  Tr, type FieldSize,
} from '../../_ui';
import {
  cardSummary, groupTitle, perUnit, rateInputId, rowView, valueSpan,
  type Draft, type RateCard, type RateGroup, type RateRow, type RowView,
} from './model';
import { BrandMark, RowChange, UnsavedMark } from './RateParts';
import s from './page.module.css';

export interface RateEditor {
  draft: Draft;
  errors: Readonly<Record<string, string>>;
  canWrite: boolean;
  isMobile: boolean;
  onRate: (row: RateRow, value: string) => void;
  onActive: (row: RateRow, active: boolean) => void;
  onRevert: (row: RateRow) => void;
  onBlur: (row: RateRow) => void;
  onAdd: (group: RateGroup) => void;
}

export interface RateCardSectionProps {
  card: RateCard;
  expanded: boolean;
  changes: number;
  issues: number;
  editor: RateEditor;
  onToggle: (id: string) => void;
}

interface RowProps {
  row: RateRow;
  editor: RateEditor;
}

function statusOf(active: boolean) {
  return <StatusDot status={active ? 'active' : 'inactive'} label={active ? 'Active' : 'Switched off'} />;
}

function RateInput({ row, view, editor, compact }: RowProps & { view: RowView; compact: boolean }) {
  const size: FieldSize = compact ? 'sm' : 'md';
  return (
    <FieldShell error={editor.errors[row.id]} className={compact ? s.rateField : s.mobileRate}>
      <Input
        id={rateInputId(row.id)}
        size={size}
        mono
        inputMode="decimal"
        autoComplete="off"
        spellCheck={false}
        value={view.rate}
        className={s.rateInput}
        aria-label={`Rate for ${row.title}, in naira ${perUnit(row.path.currency)}`}
        onChange={(event) => editor.onRate(row, event.target.value)}
        onBlur={() => editor.onBlur(row)}
      />
    </FieldShell>
  );
}

function RevertButton({ row, editor }: RowProps) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      iconOnly
      leftIcon={<Undo2 size={14} aria-hidden />}
      aria-label={`Undo the unsaved change to ${row.title}`}
      onClick={() => editor.onRevert(row)}
    />
  );
}

function DesktopRow({ row, editor }: RowProps) {
  const view = rowView(row, editor.draft);
  const rowClass = view.failure ? s.rowFailed : view.changed ? s.rowChanged : undefined;
  return (
    <Tr className={rowClass}>
      <Td>
        <div className={s.rangeCell}>
          <span className={s.rangeLabel}>
            {row.label}
            {view.changed ? <UnsavedMark /> : null}
          </span>
          <span className={s.rangeSpan}>{valueSpan(row)}</span>
        </div>
      </Td>
      <Td align="right" className={s.rateCol}>
        {editor.canWrite
          ? <RateInput row={row} view={view} editor={editor} compact />
          : <Money value={row.rate} emphasis="primary" />}
      </Td>
      {editor.canWrite ? (
        <Td className={s.changeCol}>
          <RowChange view={view} />
        </Td>
      ) : null}
      <Td align={editor.canWrite ? 'center' : undefined} className={s.activeCol}>
        {editor.canWrite ? (
          <Toggle
            checked={view.active}
            aria-label={`${row.title}: active`}
            onChange={(next) => editor.onActive(row, next)}
          />
        ) : statusOf(row.active)}
      </Td>
      {editor.canWrite ? (
        <Td align="right" className={s.revertCol}>
          {view.changed ? <RevertButton row={row} editor={editor} /> : null}
        </Td>
      ) : null}
    </Tr>
  );
}

function DesktopRates({ group, editor, labelId }: { group: RateGroup; editor: RateEditor; labelId: string }) {
  const columns = editor.canWrite ? 5 : 3;
  return (
    <Table density="dense" aria-labelledby={labelId}>
      <THead>
        <Tr>
          <Th>Range</Th>
          <Th align="right" className={s.rateCol}>Rate (₦)</Th>
          {editor.canWrite ? <Th className={s.changeCol}>Change</Th> : null}
          <Th align={editor.canWrite ? 'center' : undefined} className={s.activeCol}>
            {editor.canWrite ? 'Active' : 'Status'}
          </Th>
          {editor.canWrite ? (
            <Th className={s.revertCol}>
              <span className={s.srOnly}>Undo</span>
            </Th>
          ) : null}
        </Tr>
      </THead>
      <TBody>
        {group.rows.length === 0 ? (
          <TableEmpty
            colSpan={columns}
            title="No ranges yet"
            hint={editor.canWrite ? 'Add a range to start buying this card type.' : 'No value ranges are set up for this card type.'}
          />
        ) : (
          group.rows.map((row) => <DesktopRow key={row.id} row={row} editor={editor} />)
        )}
      </TBody>
    </Table>
  );
}

function MobileControls({ row, view, editor }: RowProps & { view: RowView }) {
  return (
    <div className={s.mobileEditor}>
      <div className={s.mobileControls}>
        <RateInput row={row} view={view} editor={editor} compact={false} />
        <span className={s.mobileToggle}>
          <Toggle
            checked={view.active}
            label="Active"
            aria-label={`${row.title}: active`}
            onChange={(next) => editor.onActive(row, next)}
          />
        </span>
        {view.changed ? <RevertButton row={row} editor={editor} /> : null}
      </div>
      <RowChange view={view} />
    </div>
  );
}

function MobileRates({ group, editor, label }: { group: RateGroup; editor: RateEditor; label: string }) {
  return (
    <MobileDataList<RateRow>
      ariaLabel={label}
      items={group.rows}
      getKey={(row) => row.id}
      empty={{
        title: 'No ranges yet',
        hint: editor.canWrite ? 'Add a range to start buying this card type.' : 'No value ranges are set up for this card type.',
      }}
      renderRow={(row) => {
        const view = rowView(row, editor.draft);
        if (!editor.canWrite) {
          return {
            primary: row.label,
            value: <Money value={row.rate} />,
            secondary: valueSpan(row),
            status: statusOf(row.active),
          };
        }
        return {
          primary: row.label,
          secondary: valueSpan(row),
          flag: view.failure ? 'danger' : view.changed ? 'warning' : null,
          flagLabel: view.failure ? `Not saved: ${view.failure}` : view.changed ? 'Unsaved change' : undefined,
          actions: <MobileControls row={row} view={view} editor={editor} />,
        };
      }}
    />
  );
}

function RateGroupView({ group, editor }: { group: RateGroup; editor: RateEditor }) {
  const headingId = useId();
  const title = groupTitle(group.path);
  return (
    <section className={s.group} aria-labelledby={headingId}>
      <div className={s.groupHead}>
        <h3 id={headingId} className={s.groupTitle}>{title}</h3>
        <span className={s.groupMeta}>₦ {perUnit(group.path.currency)}</span>
        {editor.canWrite ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className={s.groupAdd}
            leftIcon={<Plus size={14} aria-hidden />}
            aria-label={`Add range to ${group.path.cardName} ${title}`}
            onClick={() => editor.onAdd(group)}
          >
            Add range
          </Button>
        ) : null}
      </div>
      {editor.isMobile
        ? <MobileRates group={group} editor={editor} label={`${group.path.cardName} ${title} rates`} />
        : <DesktopRates group={group} editor={editor} labelId={headingId} />}
    </section>
  );
}

export function RateCardSection({ card, expanded, changes, issues, editor, onToggle }: RateCardSectionProps) {
  const bodyId = useId();
  return (
    <div className={s.brand}>
      <h2 className={s.brandHeading}>
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
            <span className={s.brandMeta}>{cardSummary(card)}</span>
          </span>
          <span className={s.brandBadges}>
            {issues > 0 ? <Badge tone="danger">{issues.toLocaleString('en-NG')} to fix</Badge> : null}
            {changes > 0 ? <Badge tone="warning" dot>{changes.toLocaleString('en-NG')} unsaved</Badge> : null}
          </span>
          <ChevronDown
            size={16}
            aria-hidden
            className={expanded ? `${s.chevron} ${s.chevronOpen}` : s.chevron}
          />
        </button>
      </h2>
      {expanded ? (
        <div id={bodyId} className={s.brandBody}>
          {card.groups.length === 0 && card.emptyCountries.length === 0 ? (
            <p className={s.emptyNote}>This card has no active countries yet. Add one in Cards to set its rates.</p>
          ) : null}
          {card.groups.map((group) => <RateGroupView key={group.key} group={group} editor={editor} />)}
          {card.emptyCountries.map((country) => (
            <p key={country.id} className={s.emptyNote}>
              {country.name} has no active card types yet, so it has no rates.
            </p>
          ))}
        </div>
      ) : null}
    </div>
  );
}
