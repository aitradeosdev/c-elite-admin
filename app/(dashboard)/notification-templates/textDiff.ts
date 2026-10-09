export type DiffOp = 'equal' | 'insert' | 'delete';

export interface DiffPart {
  op: DiffOp;
  text: string;
}

export interface DiffHunk {
  parts: DiffPart[];
  clippedStart: boolean;
  clippedEnd: boolean;
}

export interface DiffSummary {
  changes: number;
  removed: number;
  added: number;
}

export type DiffSide = 'before' | 'after';

export const DIFF_CELL_LIMIT = 640000;

const TOKEN = /<[^<>]*>|\{[^{}\s]*\}|\s+|[A-Za-z0-9_\u00C0-\u024F]+|[^\s]/gu;

export function tokenize(text: string): string[] {
  return text.match(TOKEN) ?? [];
}

function append(parts: DiffPart[], op: DiffOp, text: string): void {
  if (!text) return;
  const last = parts[parts.length - 1];
  if (last && last.op === op) {
    parts[parts.length - 1] = { op, text: last.text + text };
    return;
  }
  parts.push({ op, text });
}

function longestCommon(a: readonly string[], b: readonly string[], parts: DiffPart[]): void {
  const rows = a.length;
  const cols = b.length;
  const width = cols + 1;
  const table = new Uint32Array((rows + 1) * width);
  for (let i = rows - 1; i >= 0; i--) {
    for (let j = cols - 1; j >= 0; j--) {
      table[i * width + j] = a[i] === b[j]
        ? table[(i + 1) * width + j + 1] + 1
        : Math.max(table[(i + 1) * width + j], table[i * width + j + 1]);
    }
  }
  let i = 0;
  let j = 0;
  while (i < rows && j < cols) {
    if (a[i] === b[j]) {
      append(parts, 'equal', a[i]);
      i++;
      j++;
    } else if (table[(i + 1) * width + j] >= table[i * width + j + 1]) {
      append(parts, 'delete', a[i]);
      i++;
    } else {
      append(parts, 'insert', b[j]);
      j++;
    }
  }
  while (i < rows) append(parts, 'delete', a[i++]);
  while (j < cols) append(parts, 'insert', b[j++]);
}

export function diffText(before: string, after: string, limit: number = DIFF_CELL_LIMIT): DiffPart[] {
  const parts: DiffPart[] = [];
  if (before === after) {
    append(parts, 'equal', before);
    return parts;
  }
  const a = tokenize(before);
  const b = tokenize(after);
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--;
    endB--;
  }
  append(parts, 'equal', a.slice(0, start).join(''));
  const middleA = a.slice(start, endA);
  const middleB = b.slice(start, endB);
  if (middleA.length === 0 || middleB.length === 0 || middleA.length * middleB.length > limit) {
    append(parts, 'delete', middleA.join(''));
    append(parts, 'insert', middleB.join(''));
  } else {
    longestCommon(middleA, middleB, parts);
  }
  append(parts, 'equal', a.slice(endA).join(''));
  return parts;
}

export function sideParts(parts: readonly DiffPart[], side: DiffSide): DiffPart[] {
  const hidden: DiffOp = side === 'before' ? 'insert' : 'delete';
  const out: DiffPart[] = [];
  for (const part of parts) {
    if (part.op !== hidden) append(out, part.op, part.text);
  }
  return out;
}

export function summarizeDiff(parts: readonly DiffPart[]): DiffSummary {
  let changes = 0;
  let removed = 0;
  let added = 0;
  let inChange = false;
  for (const part of parts) {
    if (part.op === 'equal') {
      inChange = false;
      continue;
    }
    if (!inChange) changes++;
    inChange = true;
    if (part.op === 'delete') removed += part.text.length;
    else added += part.text.length;
  }
  return { changes, removed, added };
}

export function diffHunks(parts: readonly DiffPart[], context: number = 80): DiffHunk[] {
  const hunks: DiffHunk[] = [];
  let open: DiffHunk | null = null;
  for (let index = 0; index < parts.length; index++) {
    const part = parts[index];
    const last = index === parts.length - 1;
    if (part.op !== 'equal') {
      if (open === null) open = { parts: [], clippedStart: false, clippedEnd: false };
      open.parts.push(part);
      continue;
    }
    if (open === null) {
      if (last) continue;
      const lead = part.text.length > context ? part.text.slice(part.text.length - context) : part.text;
      open = { parts: [{ op: 'equal', text: lead }], clippedStart: lead.length < part.text.length, clippedEnd: false };
      continue;
    }
    if (last || part.text.length > context * 2) {
      const tail = part.text.slice(0, context);
      open.parts.push({ op: 'equal', text: tail });
      open.clippedEnd = tail.length < part.text.length;
      hunks.push(open);
      open = null;
      if (!last) {
        open = { parts: [{ op: 'equal', text: part.text.slice(part.text.length - context) }], clippedStart: true, clippedEnd: false };
      }
      continue;
    }
    open.parts.push(part);
  }
  if (open !== null && open.parts.some((part) => part.op !== 'equal')) hunks.push(open);
  return hunks;
}
