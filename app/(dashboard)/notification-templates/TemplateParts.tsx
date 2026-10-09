'use client';

import { useId, useMemo, useState, type ReactNode } from 'react';
import { RotateCcw, SlidersHorizontal } from 'lucide-react';
import { Button, Input, SectionLabel } from '../../_ui';
import { scanTemplate, type TemplateChannel, type TemplateMode } from './templateRules';
import { diffHunks, diffText, sideParts, summarizeDiff, type DiffHunk, type DiffPart, type DiffSide } from './textDiff';
import { brokenRanges, markedRuns, variableHint, type FieldChange } from './templateModel';
import s from './page.module.css';

export interface TemplatePreviewProps {
  channel: TemplateChannel;
  variables: readonly string[];
  values: Readonly<Record<string, string>>;
  samples: Readonly<Record<string, string>>;
}

const FULL_DIFF_LIMIT = 1200;
const HUNK_CONTEXT = 80;
const SHOWN_HUNKS = 6;

function plural(count: number, one: string, many: string): string {
  return `${count.toLocaleString('en-NG')} ${count === 1 ? one : many}`;
}

export function TemplateSource({
  text, variables, mode = 'text', className,
}: { text: string; variables: readonly string[]; mode?: TemplateMode; className?: string }) {
  const { segments } = scanTemplate(text, variables, mode);
  return (
    <span className={className}>
      {segments.map((segment, index) => {
        if (segment.kind === 'text') return <span key={index}>{segment.text}</span>;
        return (
          <span key={index} className={segment.known ? s.token : s.tokenUnknown}>
            {segment.text}
          </span>
        );
      })}
    </span>
  );
}

export function RenderedText({
  text, variables, samples, className,
}: { text: string; variables: readonly string[]; samples: Readonly<Record<string, string>>; className?: string }) {
  const { segments, issues } = scanTemplate(text, variables, 'text');
  const ranges = brokenRanges(issues);
  const nodes: ReactNode[] = [];
  let offset = 0;
  segments.forEach((segment, index) => {
    const start = offset;
    offset += segment.text.length;
    if (segment.kind === 'text') {
      markedRuns(segment.text, start, ranges).forEach((run, part) => {
        const key = `${index}.${part}`;
        nodes.push(run.marked
          ? <span key={key} className={s.unresolved}>{run.text}</span>
          : <span key={key}>{run.text}</span>);
      });
      return;
    }
    if (!segment.known) {
      nodes.push(<span key={index} className={s.unresolved}>{segment.text}</span>);
      return;
    }
    nodes.push(
      <span key={index} className={s.sample} title={segment.text}>
        {samples[segment.name] ?? ''}
      </span>,
    );
  });
  return <span className={className}>{nodes}</span>;
}

function usageText(count: number): string {
  if (count === 0) return 'not used yet';
  return count === 1 ? 'used once' : `used ${count} times`;
}

export interface VariableChipsProps {
  variables: readonly string[];
  uses: Readonly<Record<string, number>>;
  onInsert?: (name: string) => void;
  disabled?: boolean;
  labelledBy?: string;
}

export function VariableChips({ variables, uses, onInsert, disabled, labelledBy }: VariableChipsProps) {
  if (variables.length === 0) {
    return <p className={s.hint}>This template has no variables, so its text is sent exactly as written.</p>;
  }
  return (
    <div className={s.chips} role="group" aria-labelledby={labelledBy}>
      {variables.map((name) => {
        const hint = variableHint(name);
        const count = uses[name] ?? 0;
        const token = `{${name}}`;
        if (!onInsert) {
          return (
            <span key={name} className={count > 0 ? s.chipStaticUsed : s.chipStatic} title={hint ?? undefined}>
              {token}
            </span>
          );
        }
        return (
          <button
            key={name}
            type="button"
            className={count > 0 ? s.chipUsed : s.chip}
            disabled={disabled}
            title={hint ?? undefined}
            aria-label={`Insert ${token}, ${usageText(count)}${hint ? `. ${hint}` : ''}`}
            onClick={() => onInsert(name)}
          >
            <span>{token}</span>
            {count > 0 ? <span className={s.chipCount} aria-hidden>{count}</span> : null}
          </button>
        );
      })}
    </div>
  );
}

export interface SampleValuesProps {
  variables: readonly string[];
  samples: Readonly<Record<string, string>>;
  onChange: (name: string, value: string) => void;
  onReset: () => void;
}

export function SampleValues({ variables, samples, onChange, onReset }: SampleValuesProps) {
  const [open, setOpen] = useState(false);
  const baseId = useId();
  const panelId = `${baseId}-samples`;
  if (variables.length === 0) return null;
  return (
    <div className={s.samples}>
      <div className={s.samplesBar}>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          leftIcon={<SlidersHorizontal size={14} aria-hidden />}
          aria-expanded={open}
          aria-controls={panelId}
          onClick={() => setOpen((shown) => !shown)}
        >
          {open ? 'Hide sample values' : 'Edit sample values'}
        </Button>
        {open ? (
          <Button type="button" variant="ghost" size="sm" leftIcon={<RotateCcw size={14} aria-hidden />} onClick={onReset}>
            Reset samples
          </Button>
        ) : null}
      </div>
      <div id={panelId} className={s.sampleGrid} hidden={!open}>
        {variables.map((name) => {
          const inputId = `${baseId}-${name}`;
          const hintId = `${inputId}-hint`;
          const hint = variableHint(name);
          return (
            <div key={name} className={s.sampleField}>
              <label className={s.sampleLabel} htmlFor={inputId}>{`{${name}}`}</label>
              <Input
                id={inputId}
                size="sm"
                value={samples[name] ?? ''}
                aria-describedby={hint ? hintId : undefined}
                onChange={(event) => onChange(name, event.target.value)}
              />
              {hint ? <span id={hintId} className={s.sampleHint}>{hint}</span> : null}
            </div>
          );
        })}
        <p className={s.hint}>Sample values only change this preview. Nothing is saved.</p>
      </div>
    </div>
  );
}

export function IssueList({ items }: { items: readonly string[] }) {
  return (
    <ul className={s.issues}>
      {items.map((item, index) => <li key={`${index}:${item}`}>{item}</li>)}
    </ul>
  );
}

export function FieldNotes({ warnings, removed }: { warnings: readonly string[]; removed: readonly string[] }) {
  if (warnings.length === 0 && removed.length === 0) return null;
  return (
    <ul className={s.notes}>
      {warnings.map((warning) => <li key={warning} className={s.noteWarning}>{warning}</li>)}
      {removed.length > 0 ? (
        <li className={s.noteNeutral}>
          {`No longer includes ${removed.map((name) => `{${name}}`).join(', ')}, so users will not see ${removed.length === 1 ? 'that value' : 'those values'}.`}
        </li>
      ) : null}
    </ul>
  );
}

function renderPart(part: DiffPart, index: number): ReactNode {
  if (part.op === 'equal') return <span key={index}>{part.text}</span>;
  const blank = part.text.trim() === '';
  const className = [part.op === 'delete' ? s.del : s.ins, blank && s.space].filter(Boolean).join(' ');
  return part.op === 'delete'
    ? <del key={index} className={className}>{part.text}</del>
    : <ins key={index} className={className}>{part.text}</ins>;
}

function DiffPane({
  side, parts, mono, clippedStart, clippedEnd,
}: { side: DiffSide; parts: readonly DiffPart[]; mono: boolean; clippedStart: boolean; clippedEnd: boolean }) {
  const shown = sideParts(parts, side);
  const empty = shown.every((part) => part.text === '');
  return (
    <div className={s.diffPane}>
      <span className={s.diffTag}>{side === 'before' ? 'Before' : 'After'}</span>
      <p className={mono ? s.diffTextMono : s.diffText}>
        {clippedStart ? (
          <>
            <span className={s.clip} aria-hidden>…</span>
            <span className={s.srOnly}>Earlier text not shown. </span>
          </>
        ) : null}
        {empty ? <span className={s.muted}>Empty</span> : shown.map(renderPart)}
        {clippedEnd ? (
          <>
            <span className={s.clip} aria-hidden>…</span>
            <span className={s.srOnly}> Later text not shown.</span>
          </>
        ) : null}
      </p>
    </div>
  );
}

function HunkPanes({ hunk, mono }: { hunk: DiffHunk; mono: boolean }) {
  return (
    <div className={s.diffPanes}>
      <DiffPane side="before" parts={hunk.parts} mono={mono} clippedStart={hunk.clippedStart} clippedEnd={hunk.clippedEnd} />
      <DiffPane side="after" parts={hunk.parts} mono={mono} clippedStart={hunk.clippedStart} clippedEnd={hunk.clippedEnd} />
    </div>
  );
}

export function FieldDiff({ change }: { change: FieldChange }) {
  const parts = useMemo(() => diffText(change.before, change.after), [change.before, change.after]);
  const mono = change.field.mode === 'html';
  const long = mono || change.before.length + change.after.length > FULL_DIFF_LIMIT;
  const summary = useMemo(() => summarizeDiff(parts), [parts]);
  const hunks = useMemo(() => (long ? diffHunks(parts, HUNK_CONTEXT) : []), [long, parts]);
  const hidden = Math.max(0, hunks.length - SHOWN_HUNKS);
  return (
    <section className={s.diffField}>
      <div className={s.diffHead}>
        <SectionLabel flush>{change.field.label}</SectionLabel>
        <span className={s.diffSummary}>
          {`${plural(summary.changes, 'change', 'changes')} · ${plural(summary.removed, 'character', 'characters')} removed · ${plural(summary.added, 'character', 'characters')} added`}
        </span>
      </div>
      {long ? (
        <>
          {hunks.slice(0, SHOWN_HUNKS).map((hunk, index) => <HunkPanes key={index} hunk={hunk} mono={mono} />)}
          {hidden > 0 ? (
            <details className={s.moreHunks}>
              <summary className={s.moreHunksSummary}>{`Show ${plural(hidden, 'more change', 'more changes')}`}</summary>
              <div className={s.moreHunksBody}>
                {hunks.slice(SHOWN_HUNKS).map((hunk, index) => <HunkPanes key={index} hunk={hunk} mono={mono} />)}
              </div>
            </details>
          ) : null}
        </>
      ) : (
        <div className={s.diffPanes}>
          <DiffPane side="before" parts={parts} mono={mono} clippedStart={false} clippedEnd={false} />
          <DiffPane side="after" parts={parts} mono={mono} clippedStart={false} clippedEnd={false} />
        </div>
      )}
    </section>
  );
}

export function ChangeReview({ lead, changes }: { lead: string | null; changes: readonly FieldChange[] }) {
  return (
    <div className={s.review}>
      {lead ? <p className={s.reviewLead}>{lead}</p> : null}
      {changes.map((change) => <FieldDiff key={change.field.name} change={change} />)}
    </div>
  );
}

export function StateChange({ from, to }: { from: string; to: string }) {
  return (
    <span className={s.change}>
      <span className={s.changeFrom}>{from}</span>
      <span className={s.changeArrow} aria-hidden>→</span>
      <span className={s.srOnly}>to</span>
      <span>{to}</span>
    </span>
  );
}

export function PushPreview({ variables, values, samples }: TemplatePreviewProps) {
  const title = values.title ?? '';
  const body = values.body ?? '';
  return (
    <figure className={s.pushFigure}>
      <div className={s.push}>
        <div className={s.pushHead}>
          <span className={s.appIcon} aria-hidden>CE</span>
          <span className={s.appName}>CardElite</span>
          <span className={s.pushTime}>now</span>
        </div>
        <p className={s.pushTitle}>
          {title.trim() ? <RenderedText text={title} variables={variables} samples={samples} /> : <span className={s.muted}>No title</span>}
        </p>
        <p className={s.pushBody}>
          {body.trim() ? <RenderedText text={body} variables={variables} samples={samples} /> : <span className={s.muted}>No body</span>}
        </p>
      </div>
      <figcaption className={s.previewCaption}>
        Sent as a push notification and listed in the app’s notifications. Dotted underlines mark sample values; a wavy
        underline marks text that would reach users exactly as typed.
      </figcaption>
    </figure>
  );
}
