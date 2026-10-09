'use client';

import {
  forwardRef, useEffect, useId, useMemo, useRef, useState,
  type CSSProperties, type HTMLAttributes, type ReactNode,
} from 'react';
import { Check, ChevronRight, Copy } from 'lucide-react';
import { Button } from './Button';
import { useToast } from './Misc';
import { copyToClipboard } from './Value';
import {
  MASK, inspectJson, isJsonBranch, jsonChildAt, toMaskedJson,
  type JsonBranch, type JsonInspection, type JsonLeafKind,
} from '../lib/mask';
import s from './JsonViewer.module.css';

export interface JsonViewerProps extends Omit<HTMLAttributes<HTMLDivElement>, 'children'> {
  value: unknown;
  label?: string;
  defaultExpandDepth?: number;
  maxHeight?: number | string;
  copyable?: boolean;
  maskKeys?: readonly string[];
}

interface Settings {
  maskKeys: ReadonlySet<string>;
  expandDepth: number;
}

interface EntryProps {
  node: JsonInspection;
  name: string | null;
  label: string;
  depth: number;
  comma: boolean;
  settings: Settings;
}

interface BranchProps extends EntryProps {
  node: JsonBranch;
}

const PAGE_SIZE = 50;
const COPIED_MS = 1500;
const ROOT_LABEL = 'JSON';
const COUNT_FORMAT = new Intl.NumberFormat('en-NG');

const VALUE_CLASS: Readonly<Record<Exclude<JsonLeafKind, 'masked'>, string>> = {
  string: s.string,
  number: s.number,
  boolean: s.boolean,
  null: s.nullValue,
  undefined: s.special,
  function: s.special,
  symbol: s.special,
  circular: s.special,
  unreadable: s.special,
};

function formatCount(value: number): string {
  return COUNT_FORMAT.format(value);
}

function countLabel(size: number, array: boolean): string {
  const noun = array ? (size === 1 ? 'item' : 'items') : size === 1 ? 'key' : 'keys';
  return `${formatCount(size)} ${noun}`;
}

function moreLabel(next: number, remaining: number): string {
  const base = `Show ${formatCount(next)} more`;
  return remaining > next ? `${base} (${formatCount(remaining)} not shown)` : base;
}

function heightOf(maxHeight: number | string | undefined): string | null {
  if (typeof maxHeight === 'number') return Number.isFinite(maxHeight) && maxHeight > 0 ? `${maxHeight}px` : null;
  if (typeof maxHeight !== 'string') return null;
  const text = maxHeight.trim();
  return text && !/[;{}<>]/.test(text) ? text : null;
}

function expandDepthOf(value: number): number {
  return typeof value === 'number' && !Number.isNaN(value) ? value : 1;
}

function KeyPrefix({ name }: { name: string | null }) {
  if (name === null) return null;
  return (
    <>
      <span className={s.key}>{JSON.stringify(name)}</span>
      <span className={s.punct}>: </span>
    </>
  );
}

function LeafValue({ node }: { node: JsonInspection }) {
  if (isJsonBranch(node)) return <span className={s.punct}>{node.kind === 'array' ? '[]' : '{}'}</span>;
  if (node.kind === 'masked') {
    return (
      <span className={s.masked}>
        <span aria-hidden>{MASK}</span>
        <span className={s.srOnly}>hidden</span>
      </span>
    );
  }
  return <span className={VALUE_CLASS[node.kind]}>{node.text}</span>;
}

function JsonEntry(props: EntryProps) {
  const { node, name, comma } = props;
  if (isJsonBranch(node) && node.size > 0) return <JsonBranchEntry {...props} node={node} />;
  return (
    <span className={[s.row, s.indent].join(' ')}>
      <span className={s.text}>
        <KeyPrefix name={name} />
        <LeafValue node={node} />
        {comma ? <span className={s.punct}>,</span> : null}
      </span>
    </span>
  );
}

function JsonBranchEntry({ node, name, label, depth, comma, settings }: BranchProps) {
  const [open, setOpen] = useState(() => depth < settings.expandDepth);
  const [limit, setLimit] = useState(PAGE_SIZE);
  const [focusRequest, setFocusRequest] = useState<{ index: number } | null>(null);
  const listId = useId();
  const focusRef = useRef<HTMLLIElement>(null);

  useEffect(() => {
    if (focusRequest) focusRef.current?.focus();
  }, [focusRequest]);

  const array = node.kind === 'array';
  const openMark = array ? '[' : '{';
  const closeMark = array ? ']' : '}';
  const count = countLabel(node.size, array);
  const shown = Math.min(node.size, limit);
  const remaining = node.size - shown;

  const showMore = () => {
    setFocusRequest({ index: shown });
    setLimit(shown + PAGE_SIZE);
  };

  const entries: ReactNode[] = [];
  if (open) {
    for (let index = 0; index < shown; index += 1) {
      const child = jsonChildAt(node, index);
      const target = index === focusRequest?.index;
      entries.push(
        <li
          key={child.name}
          ref={target ? focusRef : undefined}
          tabIndex={target ? -1 : undefined}
          className={s.entry}
        >
          <JsonEntry
            node={inspectJson(child.value, {
              key: child.key,
              name: child.name,
              ancestors: node.ancestors,
              maskKeys: settings.maskKeys,
            })}
            name={child.key}
            label={child.key === null ? `Item ${index + 1}` : child.key || 'Empty key'}
            depth={depth + 1}
            comma={index < node.size - 1}
            settings={settings}
          />
        </li>,
      );
    }
  }

  return (
    <>
      <span className={s.row}>
        <button
          type="button"
          className={s.toggle}
          aria-expanded={open}
          aria-controls={open ? listId : undefined}
          aria-label={`${label}, ${array ? 'array' : 'object'}, ${count}`}
          onClick={() => setOpen((current) => !current)}
        >
          <span className={s.twisty}>
            <ChevronRight className={s.chevron} size={14} aria-hidden />
          </span>
          <span className={s.text}>
            <KeyPrefix name={name} />
            <span className={s.punct}>{openMark}</span>
            {open ? null : (
              <>
                <span className={s.count}>{` ${count} `}</span>
                <span className={s.punct}>{closeMark}</span>
              </>
            )}
          </span>
        </button>
        {!open && comma ? <span className={s.punct}>,</span> : null}
      </span>
      {open ? (
        <>
          <ul id={listId} className={s.children} role="list">
            {entries}
            {remaining > 0 ? (
              <li className={[s.entry, s.row, s.indent].join(' ')}>
                <button type="button" className={s.more} onClick={showMore}>
                  {moreLabel(Math.min(PAGE_SIZE, remaining), remaining)}
                </button>
              </li>
            ) : null}
          </ul>
          <span className={[s.row, s.indent].join(' ')}>
            <span className={s.text}>
              <span className={s.punct}>{closeMark}</span>
              {comma ? <span className={s.punct}>,</span> : null}
            </span>
          </span>
        </>
      ) : null}
    </>
  );
}

export const JsonViewer = forwardRef<HTMLDivElement, JsonViewerProps>(function JsonViewer(
  { value, label, defaultExpandDepth = 1, maxHeight, copyable = false, maskKeys, className, ...rest },
  ref,
) {
  const toast = useToast();
  const baseId = useId();
  const titleId = `${baseId}-title`;
  const [copied, setCopied] = useState(false);
  const mountedRef = useRef(false);
  const timerRef = useRef<number | null>(null);

  const settings = useMemo<Settings>(
    () => ({ maskKeys: new Set(maskKeys ?? []), expandDepth: expandDepthOf(defaultExpandDepth) }),
    [maskKeys, defaultExpandDepth],
  );

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
      timerRef.current = null;
    };
  }, []);

  const title = typeof label === 'string' ? label.trim() : '';
  const height = heightOf(maxHeight);
  const bodyStyle = height ? ({ '--json-viewer-max-height': height } as CSSProperties) : undefined;
  const root = inspectJson(value, { maskKeys: settings.maskKeys });

  const handleCopy = () => {
    let text: string;
    try {
      text = toMaskedJson(value, { maskKeys: settings.maskKeys });
    } catch {
      toast.show('This value could not be converted to JSON for copying.', 'error');
      return;
    }
    void copyToClipboard(text).then((ok) => {
      if (!ok) {
        toast.show('Could not copy the JSON to the clipboard.', 'error');
        return;
      }
      toast.show('JSON copied to the clipboard.', 'success');
      if (!mountedRef.current) return;
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
      setCopied(true);
      timerRef.current = window.setTimeout(() => {
        timerRef.current = null;
        setCopied(false);
      }, COPIED_MS);
    });
  };

  return (
    <div ref={ref} {...rest} className={[s.root, className].filter(Boolean).join(' ')}>
      {title || copyable ? (
        <div className={s.header}>
          {title ? <span id={titleId} className={s.title}>{title}</span> : null}
          {copyable ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className={s.copy}
              leftIcon={copied
                ? <Check className={s.copiedIcon} size={14} aria-hidden />
                : <Copy size={14} aria-hidden />}
              aria-describedby={title ? titleId : undefined}
              onClick={handleCopy}
            >
              Copy JSON
            </Button>
          ) : null}
        </div>
      ) : null}
      <div
        className={s.body}
        style={bodyStyle}
        tabIndex={0}
        role="region"
        aria-labelledby={title ? titleId : undefined}
        aria-label={title ? undefined : ROOT_LABEL}
      >
        <div className={s.entry}>
          <JsonEntry
            node={root}
            name={null}
            label={title || ROOT_LABEL}
            depth={0}
            comma={false}
            settings={settings}
          />
        </div>
      </div>
    </div>
  );
});
