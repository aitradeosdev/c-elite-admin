import { before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createElement } from 'react';
import ts from 'typescript';
import { loadAppModule, render, tagsOf, textOf, withClass } from './support/uiHarness.ts';
import type {
  ActivityEvent, AdminInfo, LookupRow, StoredAuditRow,
} from '../app/(dashboard)/activity/rules.ts';
import type { ActivityView } from '../app/(dashboard)/activity/model.ts';

type RulesModule = typeof import('../app/(dashboard)/activity/rules.ts');
type ModelModule = typeof import('../app/(dashboard)/activity/model.ts');
type PartsModule = typeof import('../app/(dashboard)/activity/ActivityParts.tsx');

let rules: RulesModule;
let model: ModelModule;
let parts: PartsModule;

before(async () => {
  rules = await loadAppModule<RulesModule>('(dashboard)/activity/rules.ts');
  model = await loadAppModule<ModelModule>('(dashboard)/activity/model.ts');
  parts = await loadAppModule<PartsModule>('(dashboard)/activity/ActivityParts.tsx');
});

const OWNED_DIR = fileURLToPath(new URL('../app/(dashboard)/activity/', import.meta.url));
const ROUTE_FILE = fileURLToPath(new URL('../app/api/activity/route.ts', import.meta.url));
const APP_DIR = fileURLToPath(new URL('../app/', import.meta.url));
const CATALOGUE_FILE = join(OWNED_DIR, 'rules.ts');
const AUDIT_MODULE = join(APP_DIR, 'lib', 'audit.ts');
const SQL_FILES = ['../../schema.sql', '../../schema_admin_app.sql'].map((path) => fileURLToPath(new URL(path, import.meta.url)));
const EDGE_DIR = fileURLToPath(new URL('../../supabase/functions/', import.meta.url));
const SIBLINGS_PRESENT = SQL_FILES.every((file) => existsSync(file)) && existsSync(EDGE_DIR);
const FIXTURE_DIR = join(APP_DIR, 'api', 'activity-fixture');
const FIXTURE_ROUTE = join(FIXTURE_DIR, 'route.ts');
const RETIRED_GROUP = 'Retired actions';
const ACTION_BINDING = /^(?:\w+_)?action$/i;
const ACTION_TYPE = /Action$/;
const AUDIT_CALLEE = /audit/i;
const AUDIT_TYPE = /\bAuditInput\b/;
const AUDIT_WRITE = /\bwriteAudit(?:OrFail)?\(|from\('audit_log'\)\s*\.insert\(/;
const FOLLOW_DEPTH = 8;
const WRITER_ROUTES: Readonly<Record<string, string>> = {
  MFA_RECOVERY_CODES_REPLACED: 'account/mfa/recovery-codes/route.ts',
  MFA_RESET: 'admin-accounts/[id]/mfa/route.ts',
  ADMIN_SESSION_REVOKED: 'account/sessions/[id]/route.ts',
  ADMIN_SESSIONS_SIGNED_OUT_OTHERS: 'account/sessions/sign-out-others/route.ts',
  ADMIN_SESSIONS_SIGNED_OUT_EVERYWHERE: 'account/sessions/sign-out-everywhere/route.ts',
  SECURITY_POLICY_CHANGED: 'admin-settings/security-policy/route.ts',
};

const EVENT_ID = '0b6f9a8e-2c1d-4e5f-8a9b-1c2d3e4f5a6b';
const ADMIN_ID = '7b0c3c2e-5d1f-4a8e-9f00-1a2b3c4d5e6f';
const USER_ID = '11111111-2222-4333-8444-555555555555';
const WITHDRAWAL_ID = '22222222-3333-4444-8555-666666666666';
const SUBMISSION_ID = '33333333-4444-4555-8666-777777777777';
const CARD_ID = '44444444-5555-4666-8777-888888888888';
const TYPE_ID = '55555555-6666-4777-8888-999999999999';
const RANGE_ID = '66666666-7777-4888-8999-aaaaaaaaaaaa';
const ROLE_ID = '77777777-8888-4999-8aaa-bbbbbbbbbbbb';
const STAMP = '2026-10-02T13:05:33.000Z';

const ADMIN: AdminInfo = {
  id: ADMIN_ID,
  username: 'ops',
  role_title: 'Operations Lead',
  is_super_admin: true,
  is_active: true,
  deleted_at: null,
};

function stored(patch: Partial<StoredAuditRow> = {}): StoredAuditRow {
  return {
    id: EVENT_ID,
    admin_id: ADMIN_ID,
    user_id: null,
    action: 'APPROVE_WITHDRAWAL',
    entity: 'withdrawals',
    entity_id: WITHDRAWAL_ID,
    before_value: { status: 'pending_review' },
    after_value: { status: 'processing' },
    ip_address: '102.89.4.10',
    created_at: STAMP,
    admin_role: null,
    user_agent: null,
    request_id: null,
    reason: null,
    result: null,
    error: null,
    sensitivity: null,
    ...patch,
  };
}

function event(patch: Partial<ActivityEvent> = {}): ActivityEvent {
  return {
    ...rules.presentEvent(stored(), ADMIN, { username: 'ada', label: '₦5,000.00 to GTBank' }),
    ...patch,
  };
}

function lookupFrom(data: Record<string, LookupRow[]>) {
  return (entity: string, id: unknown): LookupRow | null =>
    (typeof id === 'string' ? data[entity]?.find((row) => row.id === id) ?? null : null);
}

const STORE = lookupFrom({
  users: [{ id: USER_ID, username: 'ada' }],
  withdrawals: [{ id: WITHDRAWAL_ID, user_id: USER_ID, amount: 5000, bank_name: 'GTBank' }],
  card_submissions: [{ id: SUBMISSION_ID, user_id: USER_ID, card_id: CARD_ID, amount_foreign: 100, payout_naira: 45000 }],
  cards: [{ id: CARD_ID, name: 'Amazon' }],
  card_types: [{ id: TYPE_ID, card_id: CARD_ID, name: 'E-code', country_code: 'US' }],
  denominations: [{ id: RANGE_ID, card_type_id: TYPE_ID, range_label: '$25-$100', rate_naira: 1450 }],
});

const adminOf = (id: string) => (id === ADMIN_ID ? ADMIN : undefined);

function view(patch: Partial<ActivityView> = {}): ActivityView {
  return {
    ...model.ACTIVITY_URL.parse(new URLSearchParams()),
    ...patch,
  };
}

function ownedSources(): string[] {
  return [
    ...readdirSync(OWNED_DIR).filter((name) => /\.(ts|tsx)$/.test(name)).map((name) => join(OWNED_DIR, name)),
    ROUTE_FILE,
  ];
}

interface ActionScan {
  actions: Set<string>;
  dynamic: string[];
  unresolved: string[];
  rows: number;
}

interface ConsoleScan extends ActionScan {
  silentWriters: string[];
  uncheckedWriters: string[];
}

interface DerivedInsert {
  at: string;
  actions: string[];
}

interface Binding {
  file: string;
  name: string;
}

interface Origin {
  value: ts.Expression;
  path: readonly string[];
}

interface SourceIndex {
  values: Map<string, Origin[]>;
  functions: Map<string, ts.FunctionLikeDeclaration[]>;
  imports: Map<string, Binding>;
}

const virtualSources = new Map<string, string>();
const parsedSources = new Map<string, ts.SourceFile>();
const indexedSources = new Map<ts.SourceFile, SourceIndex>();
const actionParameters = new Map<ts.FunctionLikeDeclaration, number>();
const scannedSources = new Map<string, ActionScan>();
let consoleScan: ConsoleScan | undefined;

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return /\.tsx?$/.test(entry.name) ? [path] : [];
  });
}

function hasSource(file: string): boolean {
  return virtualSources.has(file) || existsSync(file);
}

function parseSource(file: string): ts.SourceFile {
  const cached = parsedSources.get(file);
  if (cached) return cached;
  const source = ts.createSourceFile(file, virtualSources.get(file) ?? readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
  parsedSources.set(file, source);
  return source;
}

function where(node: ts.Node): string {
  const source = node.getSourceFile();
  return `${source.fileName}:${source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1}`;
}

function resolveModule(from: string, specifier: string): string | null {
  if (!specifier.startsWith('.')) return null;
  const base = resolve(dirname(from), specifier);
  return [base, `${base}.ts`, `${base}.tsx`, join(base, 'index.ts'), join(base, 'index.tsx')]
    .find((candidate) => /\.tsx?$/.test(candidate) && hasSource(candidate)) ?? null;
}

function relativeImports(file: string): string[] {
  const found: string[] = [];
  for (const statement of parseSource(file).statements) {
    if (!ts.isImportDeclaration(statement) && !ts.isExportDeclaration(statement)) continue;
    const specifier = statement.moduleSpecifier;
    const target = specifier && ts.isStringLiteral(specifier) ? resolveModule(file, specifier.text) : null;
    if (target) found.push(target);
  }
  return found;
}

function reachableSources(): string[] {
  const queue = [...sourceFiles(join(APP_DIR, 'api')), ...sourceFiles(join(APP_DIR, 'lib'))];
  const seen = new Set<string>();
  for (let index = 0; index < queue.length; index += 1) {
    const file = queue[index];
    if (seen.has(file) || file === CATALOGUE_FILE || !file.startsWith(APP_DIR)) continue;
    seen.add(file);
    queue.push(...relativeImports(file));
  }
  return [...seen];
}

function propertyKey(name: ts.PropertyName): string | null {
  return ts.isIdentifier(name) || ts.isStringLiteral(name) ? name.text : null;
}

function calleeName(expression: ts.LeftHandSideExpression): string {
  if (ts.isIdentifier(expression)) return expression.text;
  return ts.isPropertyAccessExpression(expression) ? expression.name.text : '';
}

function unwrapValue(node: ts.Expression): ts.Expression {
  let value = node;
  while (ts.isParenthesizedExpression(value) || ts.isAsExpression(value) || ts.isSatisfiesExpression(value) || ts.isNonNullExpression(value)) {
    value = value.expression;
  }
  return value;
}

function appendTo<T>(map: Map<string, T[]>, key: string, item: T): void {
  map.set(key, [...(map.get(key) ?? []), item]);
}

function bindPattern(index: SourceIndex, pattern: ts.ObjectBindingPattern, value: ts.Expression, path: readonly string[]): void {
  for (const element of pattern.elements) {
    const key = element.propertyName ? propertyKey(element.propertyName) : ts.isIdentifier(element.name) ? element.name.text : null;
    if (key === null || element.dotDotDotToken) continue;
    if (ts.isIdentifier(element.name)) appendTo(index.values, element.name.text, { value, path: [...path, key] });
    else if (ts.isObjectBindingPattern(element.name)) bindPattern(index, element.name, value, [...path, key]);
  }
}

function indexSource(source: ts.SourceFile): SourceIndex {
  const cached = indexedSources.get(source);
  if (cached) return cached;
  const index: SourceIndex = { values: new Map(), functions: new Map(), imports: new Map() };
  const visit = (node: ts.Node): void => {
    if (ts.isFunctionDeclaration(node) && node.name && node.body) appendTo(index.functions, node.name.text, node);
    if (ts.isVariableDeclaration(node) && node.initializer) {
      const value = node.initializer;
      if (ts.isObjectBindingPattern(node.name)) bindPattern(index, node.name, value, []);
      else if (ts.isIdentifier(node.name) && (ts.isArrowFunction(value) || ts.isFunctionExpression(value))) appendTo(index.functions, node.name.text, value);
      else if (ts.isIdentifier(node.name)) appendTo(index.values, node.name.text, { value, path: [] });
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  for (const statement of source.statements) {
    if (!ts.isImportDeclaration(statement) && !ts.isExportDeclaration(statement)) continue;
    const specifier = statement.moduleSpecifier;
    const file = specifier && ts.isStringLiteral(specifier) ? resolveModule(source.fileName, specifier.text) : null;
    const named = ts.isImportDeclaration(statement) ? statement.importClause?.namedBindings : statement.exportClause;
    if (!file || !named || ts.isNamespaceImport(named) || ts.isNamespaceExport(named)) continue;
    for (const element of named.elements) index.imports.set(element.name.text, { file, name: (element.propertyName ?? element.name).text });
  }
  indexedSources.set(source, index);
  return index;
}

function lookup<T>(source: ts.SourceFile, name: string, pick: (index: SourceIndex) => Map<string, T[]>, depth: number): T[] {
  const index = indexSource(source);
  const local = pick(index).get(name);
  if (local) return local;
  const binding = index.imports.get(name);
  return binding && depth > 0 ? lookup(parseSource(binding.file), binding.name, pick, depth - 1) : [];
}

function returnedValues(fn: ts.FunctionLikeDeclaration): ts.Expression[] {
  const body = fn.body;
  if (!body) return [];
  if (!ts.isBlock(body)) return [body];
  const found: ts.Expression[] = [];
  const collect = (node: ts.Node): void => {
    if (ts.isReturnStatement(node) && node.expression) found.push(node.expression);
    if (!ts.isFunctionLike(node)) ts.forEachChild(node, collect);
  };
  ts.forEachChild(body, collect);
  return found;
}

function members(target: ts.Expression, key: string | null): ts.Expression[] {
  if (ts.isArrayLiteralExpression(target)) return key === null ? [...target.elements] : [];
  if (!ts.isObjectLiteralExpression(target)) return [];
  const found: ts.Expression[] = [];
  for (const property of target.properties) {
    if (ts.isSpreadAssignment(property) || (key !== null && propertyKey(property.name) !== key)) continue;
    if (ts.isPropertyAssignment(property)) found.push(property.initializer);
    if (ts.isShorthandPropertyAssignment(property)) found.push(property.name);
  }
  return found;
}

function expandValue(node: ts.Expression, depth: number): ts.Expression[] {
  const value = unwrapValue(node);
  if (ts.isConditionalExpression(value)) return [...expandValue(value.whenTrue, depth), ...expandValue(value.whenFalse, depth)];
  if (depth <= 0 || ts.isObjectLiteralExpression(value) || ts.isArrayLiteralExpression(value)) return [value];
  return resolveValue(value, depth - 1).flatMap((resolved) => expandValue(resolved, depth - 1));
}

function originValues(origin: Origin, depth: number): ts.Expression[] {
  return origin.path.reduce<ts.Expression[]>(
    (values, key) => values.flatMap((value) => expandValue(value, depth)).flatMap((target) => members(target, key)),
    [origin.value],
  );
}

function resolveValue(node: ts.Expression, depth: number): ts.Expression[] {
  const source = node.getSourceFile();
  if (ts.isIdentifier(node)) {
    return lookup(source, node.text, (index) => index.values, depth).flatMap((origin) => originValues(origin, depth));
  }
  if (ts.isCallExpression(node)) {
    const callee = unwrapValue(node.expression);
    return ts.isIdentifier(callee) ? lookup(source, callee.text, (index) => index.functions, depth).flatMap(returnedValues) : [];
  }
  if (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) {
    const key = ts.isPropertyAccessExpression(node) ? node.name.text
      : ts.isStringLiteralLike(node.argumentExpression) ? node.argumentExpression.text : null;
    return expandValue(node.expression, depth).flatMap((target) => members(target, key));
  }
  return [];
}

function emptyScan(): ActionScan {
  return { actions: new Set(), dynamic: [], unresolved: [], rows: 0 };
}

function enclosingFunction(node: ts.Node): ts.SignatureDeclaration | undefined {
  for (let scope: ts.Node | undefined = node.parent; scope; scope = scope.parent) {
    if (ts.isFunctionLike(scope)) return scope;
  }
  return undefined;
}

function isParameterRef(node: ts.Expression): boolean {
  const value = unwrapValue(node);
  if (!ts.isIdentifier(value)) return false;
  for (let scope = enclosingFunction(value); scope; scope = enclosingFunction(scope)) {
    if (scope.parameters.some((parameter) => ts.isIdentifier(parameter.name) && parameter.name.text === value.text)) return true;
  }
  return false;
}

function takeValue(node: ts.Expression, scan: ActionScan, depth = FOLLOW_DEPTH, misses?: string[]): void {
  const value = unwrapValue(node);
  if (ts.isStringLiteralLike(value)) {
    if (rules.isActionKey(value.text)) scan.actions.add(value.text);
    else misses?.push(where(value));
  } else if (ts.isTemplateExpression(value)) {
    scan.dynamic.push(where(value));
  } else if (ts.isConditionalExpression(value)) {
    takeValue(value.whenTrue, scan, depth, misses);
    takeValue(value.whenFalse, scan, depth, misses);
  } else if (ts.isBinaryExpression(value)
    && (value.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken || value.operatorToken.kind === ts.SyntaxKind.BarBarToken)) {
    takeValue(value.left, scan, depth, misses);
    takeValue(value.right, scan, depth, misses);
  } else if (ts.isObjectLiteralExpression(value) || ts.isArrayLiteralExpression(value)) {
    for (const member of members(value, null)) takeValue(member, scan, depth, misses);
  } else {
    const resolved = depth > 0 ? resolveValue(value, depth) : [];
    if (resolved.length === 0 && !isParameterRef(value)) misses?.push(where(value));
    for (const found of resolved) takeValue(found, scan, depth - 1, misses);
  }
}

function requireAction(node: ts.Expression, scan: ActionScan): void {
  const misses: string[] = [];
  takeValue(node, scan, FOLLOW_DEPTH, misses);
  scan.unresolved.push(...misses);
}

function inAuditContext(literal: ts.ObjectLiteralExpression): boolean {
  let node: ts.Node = literal;
  let parent = literal.parent;
  while (ts.isParenthesizedExpression(parent) || ts.isAsExpression(parent) || ts.isSatisfiesExpression(parent)
    || ts.isConditionalExpression(parent) || ts.isArrayLiteralExpression(parent)) {
    if ((ts.isAsExpression(parent) || ts.isSatisfiesExpression(parent)) && AUDIT_TYPE.test(parent.type.getText())) return true;
    node = parent;
    parent = parent.parent;
  }
  if (ts.isCallExpression(parent)) {
    return parent.arguments.some((argument) => argument === node) && AUDIT_CALLEE.test(calleeName(parent.expression));
  }
  if (ts.isVariableDeclaration(parent)) return parent.type !== undefined && AUDIT_TYPE.test(parent.type.getText());
  if (ts.isPropertyAssignment(parent)) return propertyKey(parent.name) === 'audit';
  const fn = ts.isReturnStatement(parent) ? enclosingFunction(parent) : ts.isArrowFunction(parent) ? parent : undefined;
  return fn?.type !== undefined && AUDIT_TYPE.test(fn.type.getText());
}

function auditRows(source: ts.SourceFile): ts.ObjectLiteralExpression[] {
  const rows: ts.ObjectLiteralExpression[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isObjectLiteralExpression(node) && inAuditContext(node)) rows.push(node);
    ts.forEachChild(node, visit);
  };
  visit(source);
  for (let index = 0; index < rows.length; index += 1) {
    for (const property of rows[index].properties) {
      if (!ts.isSpreadAssignment(property)) continue;
      for (const value of expandValue(property.expression, FOLLOW_DEPTH)) {
        if (ts.isObjectLiteralExpression(value) && !rows.includes(value)) rows.push(value);
      }
    }
  }
  return rows;
}

function takeType(node: ts.TypeNode, scan: ActionScan): void {
  if (ts.isLiteralTypeNode(node) && ts.isStringLiteral(node.literal)) {
    if (rules.isActionKey(node.literal.text)) scan.actions.add(node.literal.text);
  } else if (ts.isTemplateLiteralTypeNode(node)) {
    scan.dynamic.push(where(node));
  } else if (ts.isUnionTypeNode(node)) {
    for (const member of node.types) takeType(member, scan);
  } else if (ts.isParenthesizedTypeNode(node)) {
    takeType(node.type, scan);
  }
}

function actionParameter(fn: ts.FunctionLikeDeclaration): number {
  const cached = actionParameters.get(fn);
  if (cached !== undefined) return cached;
  const flows = new Set<string>();
  const visit = (node: ts.Node): void => {
    if (ts.isShorthandPropertyAssignment(node) && node.name.text === 'action') flows.add('action');
    if (ts.isPropertyAssignment(node) && propertyKey(node.name) === 'action') {
      const value = unwrapValue(node.initializer);
      if (ts.isIdentifier(value)) flows.add(value.text);
    }
    ts.forEachChild(node, visit);
  };
  if (fn.body) visit(fn.body);
  const index = fn.parameters.findIndex((parameter) => ts.isIdentifier(parameter.name) && flows.has(parameter.name.text));
  actionParameters.set(fn, index);
  return index;
}

function takeArguments(call: ts.CallExpression, scan: ActionScan): void {
  if (AUDIT_CALLEE.test(calleeName(call.expression))) {
    for (const argument of call.arguments) {
      if (ts.isStringLiteralLike(argument) && rules.isActionKey(argument.text)) scan.actions.add(argument.text);
    }
  }
  const callee = unwrapValue(call.expression);
  if (!ts.isIdentifier(callee)) return;
  for (const fn of lookup(call.getSourceFile(), callee.text, (index) => index.functions, FOLLOW_DEPTH)) {
    const argument = call.arguments[actionParameter(fn)];
    if (argument) requireAction(argument, scan);
  }
}

function scanActions(file: string): ActionScan {
  const cached = scannedSources.get(file);
  if (cached) return cached;
  const scan = emptyScan();
  const visit = (node: ts.Node): void => {
    if (ts.isPropertyAssignment(node) && propertyKey(node.name) === 'action') {
      takeValue(node.initializer, scan);
    } else if (ts.isShorthandPropertyAssignment(node) && node.name.text === 'action') {
      takeValue(node.name, scan);
    } else if (ts.isPropertySignature(node) && node.type && propertyKey(node.name) === 'action') {
      takeType(node.type, scan);
    } else if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && ACTION_BINDING.test(node.name.text) && node.initializer) {
      takeValue(node.initializer, scan);
    } else if (ts.isTypeAliasDeclaration(node) && ACTION_TYPE.test(node.name.text)) {
      takeType(node.type, scan);
    } else if (ts.isCallExpression(node)) {
      takeArguments(node, scan);
    }
    ts.forEachChild(node, visit);
  };
  const source = parseSource(file);
  visit(source);
  for (const row of auditRows(source)) {
    const value = rowValue(row, 'action');
    if (!value) continue;
    scan.rows += 1;
    const probe = emptyScan();
    takeValue(value, probe, FOLLOW_DEPTH, probe.unresolved);
    scan.unresolved.push(...probe.unresolved);
  }
  scannedSources.set(file, scan);
  return scan;
}

function consoleActions(): ConsoleScan {
  if (consoleScan) return consoleScan;
  const files = reachableSources();
  const actions = new Set<string>();
  const dynamic: string[] = [];
  const unresolved = new Set<string>();
  for (const file of files) {
    const scan = scanActions(file);
    for (const action of scan.actions) actions.add(action);
    dynamic.push(...scan.dynamic);
    for (const site of scan.unresolved) unresolved.add(site);
  }
  const writers = files.filter((file) => file !== AUDIT_MODULE && AUDIT_WRITE.test(readFileSync(file, 'utf8')));
  consoleScan = {
    actions,
    dynamic,
    unresolved: [...unresolved].sort(),
    rows: writers.reduce((total, file) => total + scanActions(file).rows, 0),
    silentWriters: writers.filter((file) => scanActions(file).actions.size === 0),
    uncheckedWriters: writers.filter((file) => scanActions(file).rows === 0),
  };
  return consoleScan;
}

function sqlGroup(text: string, open: number): { inner: string; close: number } {
  let depth = 0;
  for (let index = open; index < text.length; index += 1) {
    const char = text[index];
    if (char === "'") {
      index = text.indexOf("'", index + 1);
    } else if (char === '-' && text[index + 1] === '-') {
      index = text.indexOf('\n', index);
    } else if (char === '(') {
      depth += 1;
    } else if (char === ')') {
      depth -= 1;
      if (depth === 0) return { inner: text.slice(open + 1, index), close: index };
    }
    if (index < 0) break;
  }
  throw new Error(`Unbalanced SQL group at offset ${open}`);
}

function splitSql(inner: string): string[] {
  const cells: string[] = [];
  let depth = 0;
  let cell = '';
  for (let index = 0; index < inner.length; index += 1) {
    const char = inner[index];
    if (char === "'") {
      const close = inner.indexOf("'", index + 1);
      if (close < 0) throw new Error('Unterminated SQL string');
      cell += inner.slice(index, close + 1);
      index = close;
    } else if (char === '-' && inner[index + 1] === '-') {
      const end = inner.indexOf('\n', index);
      cell += ' ';
      index = end < 0 ? inner.length : end;
    } else if (char === ',' && depth === 0) {
      cells.push(cell.trim());
      cell = '';
    } else {
      if (char === '(') depth += 1;
      if (char === ')') depth -= 1;
      cell += char;
    }
  }
  cells.push(cell.trim());
  return cells;
}

function sqlInserts(file: string, text: string, attributed: boolean): DerivedInsert[] {
  const found: DerivedInsert[] = [];
  for (const match of text.matchAll(/insert\s+into\s+(?:public\.)?audit_log\s*\(/gi)) {
    const offset = match.index ?? 0;
    const at = `${file}:${text.slice(0, offset).split('\n').length}`;
    const columns = sqlGroup(text, offset + match[0].length - 1);
    const names = splitSql(columns.inner).map((name) => name.toLowerCase());
    const named = names.includes('admin_id');
    if (attributed && !named) continue;
    const values = /^\s*values\s*/i.exec(text.slice(columns.close + 1));
    if (!values) {
      if (attributed) found.push({ at, actions: [] });
      continue;
    }
    let cursor = columns.close + 1 + values[0].length;
    while (text[cursor] === '(') {
      const row = sqlGroup(text, cursor);
      const cells = splitSql(row.inner);
      const anonymous = !named || /^null$/i.test(cells[names.indexOf('admin_id')] ?? '');
      if (anonymous !== attributed) {
        const expression = cells[names.indexOf('action')] ?? '';
        const actions = [...expression.matchAll(/'([^']*)'/g)].map((literal) => literal[1]).filter((value) => rules.isActionKey(value));
        found.push({ at, actions });
      }
      const next = /^\s*,\s*/.exec(text.slice(row.close + 1));
      cursor = next ? row.close + 1 + next[0].length : -1;
    }
  }
  return found;
}

function sqlAdminInserts(file: string, text = readFileSync(file, 'utf8')): DerivedInsert[] {
  return sqlInserts(file, text, true);
}

function sqlUnattributedInserts(file: string, text = readFileSync(file, 'utf8')): DerivedInsert[] {
  return sqlInserts(file, text, false);
}

function systemWrites(): string[] {
  return SQL_FILES.flatMap((file) => sqlUnattributedInserts(file))
    .flatMap((insert) => insert.actions)
    .filter((action) => action === rules.SYSTEM_ACTION);
}

function isAuditInsert(node: ts.CallExpression): boolean {
  const callee = node.expression;
  if (!ts.isPropertyAccessExpression(callee) || callee.name.text !== 'insert') return false;
  const target = callee.expression;
  if (!ts.isCallExpression(target) || !ts.isPropertyAccessExpression(target.expression)) return false;
  const [table] = target.arguments;
  return target.expression.name.text === 'from' && table !== undefined && ts.isStringLiteralLike(table) && table.text === 'audit_log';
}

function rowValue(row: ts.ObjectLiteralExpression, key: string): ts.Expression | null {
  for (const property of row.properties) {
    if (ts.isPropertyAssignment(property) && propertyKey(property.name) === key) return property.initializer;
    if (ts.isShorthandPropertyAssignment(property) && property.name.text === key) return property.name;
  }
  return null;
}

function isNothing(value: ts.Expression | null): boolean {
  return value === null || value.kind === ts.SyntaxKind.NullKeyword || (ts.isIdentifier(value) && value.text === 'undefined');
}

function insertedActions(row: ts.ObjectLiteralExpression, key: string): DerivedInsert {
  const scan = emptyScan();
  const action = rowValue(row, key);
  if (action) takeValue(action, scan);
  return { at: where(row), actions: scan.dynamic.length > 0 ? [] : [...scan.actions] };
}

function parameterKey(value: ts.Expression, parameter: string): string | null {
  let node = unwrapValue(value);
  if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken) node = unwrapValue(node.left);
  while (ts.isPropertyAccessExpression(node)) {
    const owner = unwrapValue(node.expression);
    if (ts.isIdentifier(owner)) return owner.text === parameter ? node.name.text : null;
    node = owner;
  }
  return null;
}

function helperInserts(row: ts.ObjectLiteralExpression): DerivedInsert[] | null {
  const action = rowValue(row, 'action');
  const target = action ? unwrapValue(action) : null;
  if (!target || !ts.isPropertyAccessExpression(target) || !ts.isIdentifier(target.expression)) return null;
  const parameter = target.expression.text;
  let fn: ts.Node | undefined = row.parent;
  while (fn && !ts.isFunctionLike(fn)) fn = fn.parent;
  if (!fn || !ts.isFunctionDeclaration(fn) || !fn.name) return null;
  const helper = fn.name.text;
  const index = fn.parameters.findIndex((entry) => ts.isIdentifier(entry.name) && entry.name.text === parameter);
  if (index < 0) return null;
  const adminValue = rowValue(row, 'admin_id');
  const adminKey = adminValue ? parameterKey(adminValue, parameter) : null;
  const found: DerivedInsert[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === helper) {
      const argument = node.arguments[index];
      if (!argument || !ts.isObjectLiteralExpression(argument)) {
        found.push({ at: where(argument ?? node), actions: [] });
      } else if (!(adminKey && isNothing(rowValue(argument, adminKey)))) {
        found.push(insertedActions(argument, target.name.text));
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(row.getSourceFile());
  return found;
}

function edgeAdminInserts(file: string): DerivedInsert[] {
  const found: DerivedInsert[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && isAuditInsert(node)) {
      const [payload] = node.arguments;
      const rows: readonly ts.Expression[] = payload === undefined ? [] : ts.isArrayLiteralExpression(payload) ? payload.elements : [payload];
      for (const row of rows) {
        if (!ts.isObjectLiteralExpression(row)) {
          found.push({ at: where(row), actions: [] });
          continue;
        }
        if (isNothing(rowValue(row, 'admin_id'))) continue;
        found.push(...(helperInserts(row) ?? [insertedActions(row, 'action')]));
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(parseSource(file));
  return found;
}

function databaseAndEdgeInserts(): { sql: DerivedInsert[]; edge: DerivedInsert[] } {
  return {
    sql: SQL_FILES.flatMap((file) => sqlAdminInserts(file)),
    edge: sourceFiles(EDGE_DIR).flatMap((file) => edgeAdminInserts(file)),
  };
}

function actionGroups(): Map<string, string> {
  return new Map(rules.ACTION_GROUPS.flatMap((group) => group.options.map((option): [string, string] => [option.value, group.label])));
}

function catalogueGaps(actions: Iterable<string>): string[] {
  const groups = actionGroups();
  const gaps: string[] = [];
  for (const action of actions) {
    if (!rules.isListedAction(action) || rules.actionLabel(action) === action) {
      gaps.push(`${action} has no curated label in the activity catalogue`);
    } else if (!groups.has(action)) {
      gaps.push(`${action} is not offered in the Action filter`);
    } else if (groups.get(action) === RETIRED_GROUP) {
      gaps.push(`${action} is still written but filed under ${RETIRED_GROUP}`);
    }
  }
  return gaps.sort();
}

describe('action labels', () => {
  test('derives the audited actions from the API and lib sources, in every form a name is written', () => {
    const { actions, dynamic, unresolved, silentWriters, uncheckedWriters } = consoleActions();
    assert.deepEqual(dynamic, [], 'audit action names must be plain string literals so the catalogue can label them');
    assert.deepEqual(unresolved, [], 'these audit rows name an action the scan cannot trace to an upper-case string literal');
    assert.deepEqual(silentWriters, [], 'these files write audit rows, but no action name could be read from them');
    assert.deepEqual(uncheckedWriters, [], 'these files write audit rows, but none of their rows was recognised as an AuditInput');
    for (const action of [
      'APPROVE_WITHDRAWAL', 'DELETE_COUPON', 'FREEZE_USER', 'UNFREEZE_USER', 'EXPORT_PDF',
      'DOWNLOAD_CARD_IMAGES', 'CREATE_CARD', 'UPDATE_RATE', 'UPDATE_SECURITY_LIMITS', 'OVERTURN_DISPUTE', 'REJECT_FLAG',
      'REVOKE_ADMIN_SESSIONS', 'EDIT_ADMIN', 'ENABLE_EMERGENCY_MODE', 'DISABLE_EMERGENCY_MODE', 'UPDATE_EMAIL_TEMPLATE',
      'UPDATE_NOTIFICATION_TEMPLATE', 'UPDATE_PLATFORM_BALANCE', 'CREDIT_WALLET', 'DEBIT_WALLET',
      'LOGIN', 'LOGOUT', 'MFA_CHALLENGE_FAILED', 'MFA_LOCKED', 'MFA_RECOVERY_CODE_USED', 'MFA_ENABLED', 'REAUTH',
      'REAUTH_FAILED',
    ]) {
      assert.ok(actions.has(action), `${action} was not derived from the sources`);
    }
    for (const sqlOnly of ['LOGIN_FAILED', 'ADMIN_AUTO_DEACTIVATED', 'ADMIN_AUTO_DEACTIVATION_SKIPPED', 'MFA_BREAK_GLASS_RESET']) {
      assert.ok(!actions.has(sqlOnly), `${sqlOnly} is written by the database now, never by a console route`);
    }
  });

  test('every action the console writes has a curated label, a group and an Action filter option', () => {
    const { actions } = consoleActions();
    assert.ok(actions.size > 0);
    assert.deepEqual(catalogueGaps(actions), []);
  });

  test('every action the database and edge functions write under an admin has a curated label', { skip: !SIBLINGS_PRESENT }, () => {
    const { sql, edge } = databaseAndEdgeInserts();
    assert.ok(sql.length > 0, 'no admin audit insert was found in the canonical SQL');
    assert.ok(edge.length > 0, 'no admin audit insert was found in the edge functions');
    for (const insert of [...sql, ...edge]) {
      assert.ok(insert.actions.length > 0, `no action name could be read from the audit insert at ${insert.at}`);
      assert.deepEqual(catalogueGaps(insert.actions), [], insert.at);
    }
    const written = new Set([...sql, ...edge].flatMap((insert) => insert.actions));
    for (const expected of [
      'APPROVE_CARD', 'APPROVE_CARD_CORRECTED', 'LOGIN', 'RESUME_WITHDRAWAL_OK', 'RESUME_WITHDRAWAL_FAILED',
      'RESUME_WITHDRAWAL_UNCONFIRMED', 'LOGIN_FAILED', 'ADMIN_AUTO_DEACTIVATED', 'ADMIN_AUTO_DEACTIVATION_SKIPPED', 'MFA_BREAK_GLASS_RESET',
      'MFA_CHALLENGE_FAILED', 'MFA_LOCKED', 'LOGIN_MFA_SETUP_REQUIRED', 'LOGOUT',
      'CREATE_ADMIN_ROLE', 'EDIT_ADMIN_ROLE', 'ARCHIVE_ADMIN_ROLE', 'RESTORE_ADMIN_ROLE', 'EDIT_ADMIN_ACCESS',
    ]) {
      assert.ok(written.has(expected), `${expected} was not derived from the SQL and edge functions`);
    }
    for (const unattributed of ['SEND_EMAIL', 'PIN_CHANGED']) assert.ok(!written.has(unattributed), unattributed);
  });

  test('files an action under Retired actions exactly when nothing writes it any more', { skip: !SIBLINGS_PRESENT }, () => {
    const { sql, edge } = databaseAndEdgeInserts();
    const written = new Set([
      ...consoleActions().actions,
      ...[...sql, ...edge].flatMap((insert) => insert.actions),
      ...systemWrites(),
    ]);
    assert.ok(rules.ACTION_GROUPS.some((group) => group.label === RETIRED_GROUP));
    for (const group of rules.ACTION_GROUPS) {
      for (const option of group.options) {
        if (group.label === RETIRED_GROUP) {
          assert.ok(!written.has(option.value), `${option.value} is written again; move it out of ${RETIRED_GROUP}`);
        } else if (!written.has(option.value) && Object.prototype.hasOwnProperty.call(WRITER_ROUTES, option.value)) {
          const route = join(APP_DIR, 'api', WRITER_ROUTES[option.value]);
          assert.ok(!existsSync(route), `${option.value} must be written by ${route} with a literal action`);
        } else {
          assert.ok(written.has(option.value), `${option.value} is no longer written anywhere; move it to ${RETIRED_GROUP}`);
        }
      }
    }
  });

  test('ties each device and two-step action that a later route writes to that route', () => {
    for (const [action, route] of Object.entries(WRITER_ROUTES)) {
      assert.ok(rules.isListedAction(action), action);
      assert.match(route, /^(?:account|admin-accounts|admin-settings)\/[\w[\]/-]+\/route\.ts$/, action);
      const file = join(APP_DIR, 'api', route);
      if (existsSync(file)) {
        assert.ok(scanActions(file).actions.has(action), `${route} does not write ${action}`);
      }
    }
  });

  test('derives a new action in every form a route can write it, so one without a label fails the check', () => {
    virtualSources.set(join(FIXTURE_DIR, 'names.ts'), [
      "export const PAYOUT_NAME = 'ZZ_IMPORTED_CONST';",
      "export function payoutVerb(sent: boolean) { return sent ? 'ZZ_IMPORTED_SENT' : 'ZZ_IMPORTED_HELD'; }",
    ].join('\n'));
    virtualSources.set(FIXTURE_ROUTE, [
      "import { writeAudit } from '../../lib/audit';",
      "import { PAYOUT_NAME as NAME, payoutVerb } from './names';",
      "const VERB = 'ZZ_CONST';",
      "const CODE = 'STATE_CONFLICT';",
      "const DECISIONS = { keep: 'ZZ_MAP_KEEP', drop: 'ZZ_MAP_DROP' };",
      "const MODES = { on: { status: 'on', verb: 'ZZ_NESTED_ON' }, off: { status: 'off', verb: 'ZZ_NESTED_OFF' } };",
      "const STAGES = { first: { verb: 'ZZ_DESTRUCTURED' } };",
      "function verbFor(on: boolean) { return on ? 'ZZ_RETURNED_ON' : 'ZZ_RETURNED_OFF'; }",
      "function entry(verb: string, entity: string) { return { admin: null, action: verb, entity }; }",
      "function limited(key: string, action: string) { return { p_key: key, p_action: action }; }",
      "export async function POST(on: boolean, decision: 'keep' | 'drop', mode: 'on' | 'off', stage: 'first') {",
      "  const spec = MODES[mode];",
      "  const { verb: stageVerb } = STAGES[stage];",
      "  limited('ZZ_RATE_KEY', 'ZZ_RATE_ACTION');",
      "  await writeAudit({ admin: null, action: 'ZZ_LITERAL', entity: 'x', error: CODE });",
      "  await writeAudit({ admin: null, action: on ? 'ZZ_TERNARY_ON' : 'ZZ_TERNARY_OFF', entity: 'x' });",
      "  await writeAudit({ admin: null, action: VERB, entity: 'x' });",
      "  await writeAudit({ admin: null, action: DECISIONS[decision], entity: 'x' });",
      "  await writeAudit({ admin: null, action: spec.verb, entity: 'x' });",
      "  await writeAudit({ admin: null, action: stageVerb, entity: 'x' });",
      "  await writeAudit({ admin: null, action: verbFor(on), entity: 'x' });",
      "  await writeAudit(entry('ZZ_HELPER_ARGUMENT', 'x'));",
      "  await writeAudit({ admin: null, action: NAME, entity: 'x' });",
      "  await writeAudit({ admin: null, action: payoutVerb(on), entity: 'x' });",
      '}',
    ].join('\n'));
    const written = [
      'ZZ_LITERAL', 'ZZ_TERNARY_ON', 'ZZ_TERNARY_OFF', 'ZZ_CONST', 'ZZ_MAP_KEEP', 'ZZ_MAP_DROP', 'ZZ_NESTED_ON',
      'ZZ_NESTED_OFF', 'ZZ_DESTRUCTURED', 'ZZ_RETURNED_ON', 'ZZ_RETURNED_OFF', 'ZZ_HELPER_ARGUMENT', 'ZZ_IMPORTED_CONST',
      'ZZ_IMPORTED_SENT', 'ZZ_IMPORTED_HELD',
    ];
    const scan = scanActions(FIXTURE_ROUTE);
    assert.deepEqual(scan.dynamic, []);
    assert.deepEqual(scan.unresolved, []);
    assert.deepEqual([...scan.actions].sort(), [...written].sort());
    assert.deepEqual(catalogueGaps(scan.actions), written.map((action) => `${action} has no curated label in the activity catalogue`).sort());
  });

  test('reports an action name built at run time, which no catalogue entry could match', () => {
    const file = join(FIXTURE_DIR, 'dynamic.ts');
    virtualSources.set(file, "export const entry = (kind: string) => ({ action: `ZZ_${kind}`, entity: 'x' });");
    const scan = scanActions(file);
    assert.equal(scan.actions.size, 0);
    assert.equal(scan.dynamic.length, 1);
    assert.match(scan.dynamic[0], /dynamic\.ts:1$/);
  });

  test('reports an audit row whose action cannot be traced, even beside rows that can', () => {
    const file = join(FIXTURE_DIR, 'loose.ts');
    virtualSources.set(file, [
      "import { writeAudit, type AuditInput } from '../../lib/audit';",
      "function typed(verb: string): AuditInput { return { admin: null, action: verb, entity: 'x' }; }",
      'export async function POST(body: { kind: string }, ok: boolean) {',
      "  await writeAudit({ admin: null, action: body.kind, entity: 'x' });",
      "  await writeAudit({ admin: null, action: ok ? 'ZZ_LOOSE_OK' : 'zz_lower', entity: 'x' });",
      "  const row: AuditInput = { admin: null, action: 'ZZ_LOOSE_TYPED', entity: 'x' };",
      '  await writeAudit(typed(body.kind));',
      "  await writeAudit(typed('ZZ_LOOSE_HELPER'));",
      "  const echo = { action: body.kind, entity: 'x' };",
      '  return [row, echo];',
      '}',
    ].join('\n'));
    const scan = scanActions(file);
    assert.deepEqual(scan.dynamic, []);
    assert.deepEqual([...scan.actions].sort(), ['ZZ_LOOSE_HELPER', 'ZZ_LOOSE_OK', 'ZZ_LOOSE_TYPED']);
    assert.equal(scan.rows, 4);
    assert.deepEqual(scan.unresolved.map((site) => site.slice(site.lastIndexOf(':') + 1)).sort(), ['4', '5', '7']);
  });

  test('reads the action of every admin audit insert in SQL and edge functions, and skips rows with no admin', () => {
    const sql = [
      "INSERT INTO audit_log (user_id, action, entity) VALUES (p_user_id, 'ZZ_USER_ROW', 'users');",
      "INSERT INTO public.audit_log (admin_id, action, entity) VALUES (NULL, 'ZZ_NO_ADMIN', 'x');",
      'INSERT INTO audit_log (admin_id, action, entity)',
      "  VALUES (p_admin_id, CASE WHEN p_fixed THEN 'ZZ_SQL_FIXED' ELSE 'ZZ_SQL_PLAIN' END, 'x'),",
      "         (p_admin_id, 'ZZ_SQL_SECOND', format('%s', 'y'));",
      "INSERT INTO audit_log (admin_id, action, entity) VALUES (p_admin_id, v_action, 'x');",
    ].join('\n');
    assert.deepEqual(sqlAdminInserts('fixture.sql', sql), [
      { at: 'fixture.sql:3', actions: ['ZZ_SQL_FIXED', 'ZZ_SQL_PLAIN'] },
      { at: 'fixture.sql:3', actions: ['ZZ_SQL_SECOND'] },
      { at: 'fixture.sql:6', actions: [] },
    ]);
    const edge = join(FIXTURE_DIR, 'edge.ts');
    virtualSources.set(edge, [
      'export function record(db, adminId, admin_id, sent, row) {',
      "  db.from('audit_log').insert({ admin_id: null, action: 'ZZ_EDGE_ANONYMOUS', entity: 'x' });",
      "  db.from('audit_log').insert({ admin_id: adminId, action: sent ? 'ZZ_EDGE_SENT' : 'ZZ_EDGE_FAILED', entity: 'x' });",
      "  db.from('audit_log').insert([{ admin_id, action: 'ZZ_EDGE_BATCH', entity: 'x' }]);",
      "  db.from('audit_log').insert(row);",
      '}',
    ].join('\n'));
    assert.deepEqual(edgeAdminInserts(edge).map((insert) => ({ line: insert.at.slice(insert.at.lastIndexOf(':') + 1), actions: insert.actions })), [
      { line: '3', actions: ['ZZ_EDGE_SENT', 'ZZ_EDGE_FAILED'] },
      { line: '4', actions: ['ZZ_EDGE_BATCH'] },
      { line: '5', actions: [] },
    ]);
    const helper = join(FIXTURE_DIR, 'edgeHelper.ts');
    virtualSources.set(helper, [
      'async function audit(db, meta, row) {',
      "  await db.from('audit_log').insert({ admin_id: row.admin?.id ?? null, action: row.action, entity: 'x', ip_address: meta.ip });",
      '}',
      'export async function record(db, meta, admin, locked, rows) {',
      "  await audit(db, meta, { admin, action: locked ? 'ZZ_HELPER_LOCKED' : 'ZZ_HELPER_FAILED' });",
      "  await audit(db, meta, { admin: null, action: 'ZZ_HELPER_NOBODY' });",
      "  await audit(db, meta, { action: 'ZZ_HELPER_ANONYMOUS' });",
      '  await audit(db, meta, rows[0]);',
      '}',
    ].join('\n'));
    assert.deepEqual(edgeAdminInserts(helper).map((insert) => ({ line: insert.at.slice(insert.at.lastIndexOf(':') + 1), actions: insert.actions })), [
      { line: '5', actions: ['ZZ_HELPER_LOCKED', 'ZZ_HELPER_FAILED'] },
      { line: '8', actions: [] },
    ]);
  });

  test('reads the actions the database writes with no admin, and only those', () => {
    const sql = [
      "INSERT INTO audit_log (user_id, action, entity) VALUES (p_user_id, 'ZZ_USER_ROW', 'users');",
      "INSERT INTO public.audit_log (admin_id, action, entity) VALUES (NULL, 'ZZ_NO_ADMIN', 'x');",
      'INSERT INTO audit_log (admin_id, action, entity)',
      "  VALUES (p_admin_id, 'ZZ_SQL_ADMIN', 'x'),",
      "         (NULL, 'ZZ_SQL_NOBODY', 'y');",
      "INSERT INTO audit_log (action, entity, after_value) VALUES ('ZZ_SYSTEM_RUN', 'x', jsonb_build_object('n', 1));",
      "INSERT INTO audit_log (action, entity) SELECT 'ZZ_SELECTED', 'x';",
    ].join('\n');
    assert.deepEqual(sqlUnattributedInserts('fixture.sql', sql), [
      { at: 'fixture.sql:1', actions: ['ZZ_USER_ROW'] },
      { at: 'fixture.sql:2', actions: ['ZZ_NO_ADMIN'] },
      { at: 'fixture.sql:3', actions: ['ZZ_SQL_NOBODY'] },
      { at: 'fixture.sql:6', actions: ['ZZ_SYSTEM_RUN'] },
    ]);
    assert.deepEqual(sqlAdminInserts('fixture.sql', sql), [{ at: 'fixture.sql:3', actions: ['ZZ_SQL_ADMIN'] }]);
  });

  test('labels every catalogued action in plain words, once, under a named group', () => {
    const groupLabels = rules.ACTION_GROUPS.map((group) => group.label);
    assert.equal(new Set(groupLabels).size, groupLabels.length);
    for (const group of rules.ACTION_GROUPS) {
      assert.ok(group.options.length > 0, group.label);
      for (const option of group.options) {
        assert.ok(rules.isActionKey(option.value), option.value);
        assert.match(option.label, /^[A-Z][^_]*$/, option.value);
        assert.equal(rules.actionLabel(option.value), option.label, option.value);
      }
    }
  });

  test('names the emergency switch and the wave-2 actions in plain words', () => {
    assert.equal(rules.actionLabel('ENABLE_EMERGENCY_MODE'), 'Turned on emergency mode');
    assert.equal(rules.actionLabel('DISABLE_EMERGENCY_MODE'), 'Turned off emergency mode');
    assert.equal(rules.actionLabel('REVOKE_ADMIN_SESSIONS'), 'Signed admin out everywhere');
    assert.equal(rules.actionLabel('SET_CARD_TYPE_COUNTRY_ACTIVE'), 'Changed card type availability');
    assert.equal(rules.actionLabel('UPDATE_PLATFORM_BALANCE'), 'Updated platform balance');
    assert.equal(rules.actionLabel('UPDATE_ADMIN_SETTINGS'), 'Updated platform settings');
    assert.equal(rules.actionLabel('CREATE_DENOMINATION'), 'Created rate range');
    assert.equal(rules.actionLabel('APPROVE_CARD_CORRECTED'), 'Approved card with corrections');
    assert.equal(rules.actionLabel('RESUME_WITHDRAWAL_FAILED'), 'Payout could not be sent');
  });

  test('names an unconfirmed payout so that nobody pays it again by hand', () => {
    assert.equal(
      rules.actionLabel('RESUME_WITHDRAWAL_UNCONFIRMED'),
      'Payout could not be confirmed, stays processing, do not pay again by hand',
    );
    const risk = rules.ACTION_GROUPS.find((group) => group.label === 'Withdrawals and risk');
    const values = risk?.options.map((option) => option.value) ?? [];
    assert.equal(values.indexOf('RESUME_WITHDRAWAL_UNCONFIRMED'), values.indexOf('RESUME_WITHDRAWAL_FAILED') + 1);
    assert.ok(rules.actionsMatching('do not pay again').includes('RESUME_WITHDRAWAL_UNCONFIRMED'));
  });

  test('names wallet adjustments under Users, in plain words', () => {
    assert.equal(rules.actionLabel('CREDIT_WALLET'), 'Credited wallet');
    assert.equal(rules.actionLabel('DEBIT_WALLET'), 'Debited wallet');
    const users = rules.ACTION_GROUPS.find((group) => group.label === 'Users');
    assert.ok(users?.options.some((option) => option.value === 'CREDIT_WALLET'));
    assert.ok(users?.options.some((option) => option.value === 'DEBIT_WALLET'));
    const wallet = rules.actionsMatching('wallet');
    assert.ok(wallet.includes('CREDIT_WALLET') && wallet.includes('DEBIT_WALLET'));
  });

  test('names staff account deletions under Users, written by the database', { skip: !SIBLINGS_PRESENT }, () => {
    assert.equal(rules.actionLabel('DELETE_USER_ACCOUNT'), 'Deleted user account');
    const users = rules.ACTION_GROUPS.find((group) => group.label === 'Users');
    const values = users?.options.map((option) => option.value) ?? [];
    assert.equal(values.indexOf('DELETE_USER_ACCOUNT'), values.indexOf('UNFREEZE_USER') + 1);
    const written = new Set(databaseAndEdgeInserts().sql.flatMap((insert) => insert.actions));
    assert.ok(written.has('DELETE_USER_ACCOUNT'));
  });

  test('names own password changes under Admins and sign-in, written by the password route', () => {
    assert.equal(rules.actionLabel('PASSWORD_CHANGED'), 'Changed own password');
    assert.equal(rules.actionLabel('PASSWORD_CHANGE_FAILED'), 'Password change failed');
    const signIn = rules.ACTION_GROUPS.find((group) => group.label === 'Admins and sign-in');
    const values = signIn?.options.map((option) => option.value) ?? [];
    assert.ok(values.includes('PASSWORD_CHANGED') && values.includes('PASSWORD_CHANGE_FAILED'));
    assert.ok(values.indexOf('LOGOUT') < values.indexOf('PASSWORD_CHANGED'));
    const password = rules.actionsMatching('password');
    assert.ok(password.includes('PASSWORD_CHANGED') && password.includes('PASSWORD_CHANGE_FAILED'));
    const route = scanActions(join(APP_DIR, 'api', 'account', 'password', 'route.ts'));
    assert.deepEqual([...route.actions].sort(), ['PASSWORD_CHANGED', 'PASSWORD_CHANGE_FAILED']);
    assert.deepEqual(route.unresolved, []);
    assert.equal(route.rows, 3);
  });

  test('names every two-step sign-in, identity check and device action under Admins and sign-in', () => {
    const expected: Array<[string, string]> = [
      ['LOGIN_MFA_SETUP_REQUIRED', 'Sign-in needed two-step setup'],
      ['MFA_ENABLED', 'Turned on two-step sign-in'],
      ['MFA_CHALLENGE_FAILED', 'Two-step code failed'],
      ['MFA_LOCKED', 'Two-step sign-in locked'],
      ['MFA_RECOVERY_CODE_USED', 'Signed in with a recovery code'],
      ['MFA_RECOVERY_CODES_REPLACED', 'Replaced recovery codes'],
      ['MFA_RESET', 'Reset admin two-step sign-in'],
      ['MFA_BREAK_GLASS_RESET', 'Two-step sign-in reset in the database'],
      ['REAUTH', 'Confirmed identity'],
      ['REAUTH_FAILED', 'Security check failed'],
      ['ADMIN_SESSION_REVOKED', 'Signed out a device'],
      ['ADMIN_SESSIONS_SIGNED_OUT_OTHERS', 'Signed out other devices'],
      ['ADMIN_SESSIONS_SIGNED_OUT_EVERYWHERE', 'Signed out everywhere'],
      ['SECURITY_POLICY_CHANGED', 'Changed two-step requirement'],
    ];
    const signIn = rules.ACTION_GROUPS.find((group) => group.label === 'Admins and sign-in');
    const values = signIn?.options.map((option) => option.value) ?? [];
    for (const [action, label] of expected) {
      assert.equal(rules.actionLabel(action), label, action);
      assert.ok(values.includes(action), `${action} is not offered under Admins and sign-in`);
    }
    for (const action of ['LOGIN', 'LOGIN_FAILED', 'LOGOUT', 'ADMIN_AUTO_DEACTIVATED', 'ADMIN_AUTO_DEACTIVATION_SKIPPED']) {
      assert.ok(values.includes(action), action);
    }
    const twoStep = rules.actionsMatching('two-step');
    for (const action of ['MFA_CHALLENGE_FAILED', 'MFA_LOCKED', 'MFA_ENABLED', 'MFA_RESET', 'SECURITY_POLICY_CHANGED']) {
      assert.ok(twoStep.includes(action), action);
    }
  });

  test('names role changes and access changes under Admins and sign-in', () => {
    const expected: Array<[string, string]> = [
      ['CREATE_ADMIN_ROLE', 'Created role'],
      ['EDIT_ADMIN_ROLE', 'Edited role'],
      ['ARCHIVE_ADMIN_ROLE', 'Archived role'],
      ['RESTORE_ADMIN_ROLE', 'Restored role'],
      ['EDIT_ADMIN_ACCESS', 'Changed admin access'],
    ];
    const signIn = rules.ACTION_GROUPS.find((group) => group.label === 'Admins and sign-in');
    const values = signIn?.options.map((option) => option.value) ?? [];
    for (const [action, label] of expected) {
      assert.equal(rules.actionLabel(action), label, action);
      assert.ok(rules.isListedAction(action), action);
      assert.ok(values.includes(action), `${action} is not offered under Admins and sign-in`);
    }
    assert.equal(values.indexOf('EDIT_ADMIN_ACCESS'), values.indexOf('EDIT_ADMIN') + 1);
    assert.deepEqual(
      values.slice(values.indexOf('DELETE_ADMIN') + 1, values.indexOf('DELETE_ADMIN') + 5),
      ['CREATE_ADMIN_ROLE', 'EDIT_ADMIN_ROLE', 'ARCHIVE_ADMIN_ROLE', 'RESTORE_ADMIN_ROLE'],
    );
    const role = rules.actionsMatching('role');
    for (const action of ['CREATE_ADMIN_ROLE', 'EDIT_ADMIN_ROLE', 'ARCHIVE_ADMIN_ROLE', 'RESTORE_ADMIN_ROLE']) {
      assert.ok(role.includes(action), action);
    }
    assert.ok(rules.actionsMatching('admin access').includes('EDIT_ADMIN_ACCESS'));
  });

  test('derives the sign-in and identity-check actions from the routes and the shared session module', () => {
    const sessionModule = scanActions(join(APP_DIR, 'lib', 'session.ts'));
    assert.deepEqual(sessionModule.unresolved, []);
    assert.deepEqual([...sessionModule.actions].sort(), ['LOGIN', 'MFA_CHALLENGE_FAILED', 'MFA_LOCKED', 'REAUTH_FAILED']);
    const routes: Array<[string, string[]]> = [
      ['auth/route.ts', ['MFA_CHALLENGE_FAILED']],
      ['auth/logout/route.ts', ['LOGOUT']],
      ['auth/mfa/verify/route.ts', ['MFA_CHALLENGE_FAILED', 'MFA_RECOVERY_CODE_USED']],
      ['auth/mfa/enroll/confirm/route.ts', ['MFA_ENABLED']],
      ['account/reauth/route.ts', ['REAUTH', 'REAUTH_FAILED']],
    ];
    for (const [route, actions] of routes) {
      const scan = scanActions(join(APP_DIR, 'api', route));
      assert.deepEqual(scan.unresolved, [], route);
      assert.deepEqual(scan.dynamic, [], route);
      assert.deepEqual([...scan.actions].sort(), actions, route);
    }
  });

  test('keeps the labels of retired and renamed actions', () => {
    assert.equal(rules.actionLabel('OVERTURN_CARD_DISPUTE'), 'Overturned card dispute');
    assert.equal(rules.actionLabel('UPHOLD_CARD_DISPUTE'), 'Upheld card dispute');
    assert.equal(rules.actionLabel('BATCH_UPDATE_RATES'), 'Updated rates');
    assert.equal(rules.actionLabel('GRANT_FEATURE_OVERRIDE'), 'Granted feature override');
  });

  test('humanises actions it has never seen, in the past tense', () => {
    assert.equal(rules.actionLabel('UPDATE_BONUS_SETTINGS'), 'Updated bonus settings');
    assert.equal(rules.actionLabel('SEND_TEST_PUSH'), 'Sent test push');
    assert.equal(rules.actionLabel('WIDGET_SYNC'), 'Widget sync');
    assert.equal(rules.actionLabel('CONSTRUCTOR_CALL'), 'Constructor call');
    assert.equal(rules.actionLabel(''), 'Unknown action');
    assert.equal(rules.actionLabel(null), 'Unknown action');
  });

  test('filters on a renamed action also match its old name', () => {
    assert.deepEqual(rules.actionFilterKeys('OVERTURN_DISPUTE'), ['OVERTURN_DISPUTE', 'OVERTURN_CARD_DISPUTE']);
    assert.deepEqual(rules.actionFilterKeys('UPHOLD_DISPUTE'), ['UPHOLD_DISPUTE', 'UPHOLD_CARD_DISPUTE']);
    assert.deepEqual(rules.actionFilterKeys('LOGIN'), ['LOGIN']);
    assert.deepEqual(rules.actionFilterKeys('constructor'), ['constructor']);
  });

  test('finds actions by their human label for free-text search', () => {
    const emergency = rules.actionsMatching('emergency');
    assert.ok(emergency.includes('ENABLE_EMERGENCY_MODE') && emergency.includes('DISABLE_EMERGENCY_MODE'));
    assert.ok(rules.actionsMatching('Approved withdrawal').includes('APPROVE_WITHDRAWAL'));
    assert.ok(rules.actionsMatching('rate range').includes('CREATE_DENOMINATION'));
    assert.deepEqual(rules.actionsMatching('ap'), []);
  });

  test('accepts only well-formed action and record type keys', () => {
    for (const good of ['LOGIN', 'APPROVE_WITHDRAWAL', 'EXPORT_CSV']) assert.ok(rules.isActionKey(good), good);
    for (const bad of ['login', 'A', 'LOGIN,admin_id.eq.x', 'LOGIN)', '_LOGIN', 'X'.repeat(65)]) {
      assert.ok(!rules.isActionKey(bad), bad);
    }
    for (const good of ['users', 'card_type_template_fields', 'audit_log']) assert.ok(rules.isEntityKey(good), good);
    for (const bad of ['Users', 'users)', 'users,id', '1users', '']) assert.ok(!rules.isEntityKey(bad), bad);
  });

  test('offers each action once in the filter', () => {
    const values = rules.ACTION_GROUPS.flatMap((group) => group.options.map((option) => option.value));
    assert.equal(new Set(values).size, values.length);
    assert.ok(!values.includes('OVERTURN_CARD_DISPUTE'));
  });
});

describe('results, sensitivity and record types', () => {
  test('labels and tones every result, including rows that never recorded one', () => {
    assert.equal(rules.resultLabel('success'), 'Succeeded');
    assert.equal(rules.resultLabel('failure'), 'Failed');
    assert.equal(rules.resultLabel('partial'), 'Partly completed');
    assert.equal(rules.resultLabel(null), 'Not recorded');
    assert.equal(rules.resultLabel('timed_out'), 'Timed out');
    assert.equal(rules.resultTone('success'), 'success');
    assert.equal(rules.resultTone('failure'), 'danger');
    assert.equal(rules.resultTone('partial'), 'warning');
    assert.equal(rules.resultTone(null), 'neutral');
    assert.equal(rules.resultTone('timed_out'), 'neutral');
    assert.equal(rules.resultFilterLabel('unrecorded'), 'Not recorded');
    assert.deepEqual([...rules.RESULT_FILTERS], ['success', 'failure', 'partial', 'unrecorded']);
  });

  test('labels sensitivity levels', () => {
    assert.equal(rules.sensitivityLabel('sensitive'), 'Sensitive data');
    assert.equal(rules.sensitivityLabel('financial'), 'Financial');
    assert.equal(rules.sensitivityLabel(null), null);
    assert.equal(rules.isElevatedSensitivity('security'), true);
    assert.equal(rules.isElevatedSensitivity('normal'), false);
  });

  test('names roles as a record type for the filter', () => {
    assert.equal(rules.entityLabel('admin_roles'), 'Role');
    assert.ok(rules.isListedEntity('admin_roles'));
    assert.ok(rules.ENTITY_OPTIONS.some((option) => option.value === 'admin_roles' && option.label === 'Role'));
    assert.equal(rules.entityLabel('admin_users'), 'Admin account');
  });

  test('labels record types without leaking object prototype names', () => {
    assert.equal(rules.entityLabel('card_submissions'), 'Card submission');
    assert.equal(rules.entityLabel('audit_log'), 'Audit log');
    assert.equal(rules.entityLabel('wallet_adjustments'), 'Wallet adjustment');
    assert.ok(rules.ENTITY_OPTIONS.some((option) => option.value === 'wallet_adjustments'));
    assert.equal(rules.entityLabel('some_new_table'), 'Some new table');
    assert.equal(rules.entityLabel('constructor'), 'Constructor');
    assert.equal(rules.entityLabel(null), '');
    assert.equal(rules.isListedEntity('constructor'), false);
  });
});

describe('older rows that folded extended fields into after_value.__meta', () => {
  const meta = {
    admin_role: 'Reviewer',
    user_agent: 'Mozilla/5.0',
    request_id: 'req_abc123',
    reason: 'Duplicate request',
    result: 'failure',
    error: 'Gateway timeout',
    sensitivity: 'financial',
  };

  test('strips __meta from an object payload and returns the fields', () => {
    const split = rules.splitMeta({ status: 'processing', __meta: meta });
    assert.deepEqual(split.after, { status: 'processing' });
    assert.deepEqual(split.meta, meta);
  });

  test('unwraps a scalar, array or empty payload that was wrapped in value', () => {
    assert.equal(rules.splitMeta({ value: null, __meta: meta }).after, null);
    assert.deepEqual(rules.splitMeta({ value: [1, 2], __meta: meta }).after, [1, 2]);
    assert.equal(rules.splitMeta({ value: 'x', __meta: meta }).after, 'x');
    assert.equal(rules.splitMeta({ __meta: meta }).after, null);
    assert.deepEqual(rules.splitMeta({ value: { a: 1 }, __meta: meta }).after, { value: { a: 1 } });
  });

  test('leaves payloads without __meta untouched', () => {
    const payload = { status: 'held' };
    assert.equal(rules.splitMeta(payload).after, payload);
    assert.equal(rules.splitMeta(payload).meta, null);
    assert.equal(rules.splitMeta(undefined).after, null);
    assert.equal(rules.splitMeta({ __meta: 'not an object' }).meta, null);
  });

  test('shows folded fields exactly like column fields, with columns winning', () => {
    const folded = rules.presentEvent(stored({ after_value: { status: 'processing', __meta: meta } }), ADMIN, {
      username: null,
      label: null,
    });
    assert.equal(folded.result, 'failure');
    assert.equal(folded.error, 'Gateway timeout');
    assert.equal(folded.request_id, 'req_abc123');
    assert.equal(folded.user_agent, 'Mozilla/5.0');
    assert.equal(folded.admin_role, 'Reviewer');
    assert.equal(folded.sensitivity, 'financial');
    assert.equal(folded.reason, 'Duplicate request');
    assert.deepEqual(folded.after_value, { status: 'processing' });

    const mixed = rules.presentEvent(
      stored({ result: 'success', request_id: 'req_column', after_value: { __meta: meta } }),
      ADMIN,
      { username: null, label: null },
    );
    assert.equal(mixed.result, 'success');
    assert.equal(mixed.request_id, 'req_column');
    assert.equal(mixed.error, 'Gateway timeout');
  });
});

describe('presenting an audit row', () => {
  test('redacts secrets that older rows stored in clear, but keeps other values', () => {
    const shown = rules.presentEvent(
      stored({
        before_value: { chatwoot_identity_key: 'live-secret', nested: { password: 'hunter2' } },
        after_value: { token: 'abc', account_number: '0123456789', amount: 5000 },
      }),
      ADMIN,
      { username: null, label: null },
    );
    assert.deepEqual(shown.before_value, { chatwoot_identity_key: '[redacted]', nested: { password: '[redacted]' } });
    assert.deepEqual(shown.after_value, { token: '[redacted]', account_number: '0123456789', amount: 5000 });
  });

  test('carries the admin, the target and the legacy keys the mobile app reads', () => {
    const shown = rules.presentEvent(stored(), { ...ADMIN, deleted_at: STAMP }, { username: 'ada', label: 'x' });
    assert.equal(shown.admin_username, 'ops');
    assert.equal(shown.admin_role_title, 'Operations Lead');
    assert.equal(shown.admin_is_super, true);
    assert.equal(shown.admin_deleted, true);
    for (const key of [
      'id', 'admin_id', 'admin_username', 'admin_role_title', 'admin_is_super', 'action', 'entity', 'entity_id',
      'ip_address', 'created_at', 'target_username', 'target_label',
    ]) {
      assert.ok(key in shown, key);
    }
    const orphan = rules.presentEvent(stored({ admin_id: null }), undefined, { username: null, label: null });
    assert.equal(orphan.admin_username, null);
    assert.equal(orphan.admin_is_super, false);
  });

  test('masks account numbers, tokens and card codes before they reach a screen', () => {
    const shown = rules.forScreen(rules.presentEvent(
      stored({
        before_value: { account_number: '0123456789', nested: [{ electricity_token: '1234-5678-9012' }] },
        after_value: { submitted_fields: { code: 'ABCD-EFGH' }, password: 'x', amount: 5000 },
      }),
      ADMIN,
      { username: null, label: null },
    ));
    assert.deepEqual(shown.before_value, { account_number: '•••• 6789', nested: [{ electricity_token: '•••• 9012' }] });
    assert.deepEqual(shown.after_value, { submitted_fields: '••••', password: '[redacted]', amount: 5000 });
    assert.deepEqual(rules.screenValue({ chatwoot_identity_key: 'k', ok: true }), { chatwoot_identity_key: '[redacted]', ok: true });
    assert.equal(rules.screenValue(undefined), null);
  });

  test('keeps full account numbers in the CSV export, as the owner decided (D-13)', () => {
    const csv = rules.toCsv([rules.presentEvent(
      stored({ after_value: { account_number: '0123456789', pin: '1234' } }),
      ADMIN,
      { username: null, label: null },
    )]);
    assert.match(csv, /0123456789/);
    assert.doesNotMatch(csv, /""pin"":""1234""/);
  });

  test('drops before and after values from printable rows', () => {
    const printable = rules.toPrintable(event());
    assert.ok(!('before_value' in printable));
    assert.ok(!('after_value' in printable));
    assert.equal(printable.id, EVENT_ID);
  });

  test('formats timestamps in Lagos time with seconds', () => {
    assert.equal(rules.formatStamp(STAMP), '02 Oct 2026, 14:05:33');
    assert.equal(rules.formatStamp('2026-10-01T23:30:00.000Z'), '02 Oct 2026, 00:30:00');
    assert.equal(rules.formatStamp('nope'), '—');
    assert.equal(rules.formatStamp(null), '—');
  });

  test('masks account numbers and card codes in the before and after viewers', () => {
    assert.ok(rules.JSON_MASK_KEYS.includes('account_number'));
    assert.ok(rules.JSON_MASK_KEYS.includes('electricity_token'));
    assert.ok(rules.JSON_MASK_KEYS.includes('submitted_fields'));
  });
});

describe('naming the target of each event', () => {
  test('names users, withdrawals, card submissions and rate ranges', () => {
    assert.deepEqual(
      rules.resolveTarget({ entity: 'users', entity_id: USER_ID, user_id: USER_ID }, STORE, adminOf),
      { username: 'ada', label: '@ada' },
    );
    assert.deepEqual(
      rules.resolveTarget({ entity: 'withdrawals', entity_id: WITHDRAWAL_ID, user_id: null }, STORE, adminOf),
      { username: 'ada', label: '₦5,000.00 to GTBank' },
    );
    assert.deepEqual(
      rules.resolveTarget({ entity: 'card_submissions', entity_id: SUBMISSION_ID, user_id: null }, STORE, adminOf),
      { username: 'ada', label: 'Amazon · $100 (₦45,000.00)' },
    );
    assert.deepEqual(
      rules.resolveTarget({ entity: 'denominations', entity_id: RANGE_ID, user_id: null }, STORE, adminOf),
      { username: null, label: 'Amazon · $25-$100 (₦1,450.00)' },
    );
  });

  test('names admin accounts from the admin roster', () => {
    assert.deepEqual(
      rules.resolveTarget({ entity: 'admin_users', entity_id: ADMIN_ID, user_id: null }, STORE, adminOf),
      { username: 'ops', label: '@ops' },
    );
  });

  test('names a role target by its name, reading only its id and name', () => {
    const spec = rules.targetSpec('admin_roles');
    assert.equal(spec?.table, 'admin_roles');
    assert.equal(spec?.columns, 'id, name');
    assert.equal(spec?.owner, undefined);
    assert.equal(spec?.refs, undefined);
    const roles = lookupFrom({ admin_roles: [{ id: ROLE_ID, name: 'Manager' }] });
    assert.deepEqual(
      rules.resolveTarget({ entity: 'admin_roles', entity_id: ROLE_ID, user_id: null }, roles, adminOf),
      { username: null, label: 'Manager' },
    );
    assert.deepEqual(
      rules.resolveTarget({ entity: 'admin_roles', entity_id: '99999999-9999-4999-8999-999999999999', user_id: null }, roles, adminOf),
      { username: null, label: null },
    );
    assert.deepEqual(rules.targetRefs('admin_roles', { id: ROLE_ID, name: 'Manager' }), []);
  });

  test('labels role targets the way the database list does', { skip: !SIBLINGS_PRESENT }, () => {
    const sql = readFileSync(SQL_FILES[1], 'utf8');
    const list = sql.slice(sql.indexOf('CREATE OR REPLACE FUNCTION list_admin_activity('));
    assert.match(
      list.slice(0, list.indexOf('$$;')),
      /WHEN al\.entity = 'admin_roles' THEN \(SELECT r\.name FROM admin_roles r WHERE r\.id::text = al\.entity_id\)/,
    );
  });

  test('passes configuration keys and template keys through', () => {
    assert.equal(rules.resolveTarget({ entity: 'app_config', entity_id: 'batch', user_id: null }, STORE, adminOf).label, 'Several settings');
    assert.equal(
      rules.resolveTarget({ entity: 'notification_templates', entity_id: 'withdrawal_success', user_id: null }, STORE, adminOf).label,
      'withdrawal_success',
    );
  });

  test('falls back to the audited user when the target row is gone or unknown', () => {
    const missing = rules.resolveTarget(
      { entity: 'withdrawals', entity_id: '99999999-9999-4999-8999-999999999999', user_id: USER_ID },
      STORE,
      adminOf,
    );
    assert.deepEqual(missing, { username: 'ada', label: null });
    assert.deepEqual(rules.resolveTarget({ entity: 'mystery', entity_id: 'x', user_id: null }, STORE, adminOf), {
      username: null,
      label: null,
    });
    assert.deepEqual(rules.resolveTarget({ entity: null, entity_id: null, user_id: null }, STORE, adminOf), {
      username: null,
      label: null,
    });
  });

  test('follows card and owner references for the next lookup round', () => {
    assert.deepEqual(
      rules.targetRefs('card_submissions', { id: SUBMISSION_ID, user_id: USER_ID, card_id: CARD_ID }),
      [{ entity: 'cards', id: CARD_ID }, { entity: 'users', id: USER_ID }],
    );
    assert.deepEqual(rules.targetRefs('denominations', { id: RANGE_ID, card_type_id: TYPE_ID }), [
      { entity: 'card_types', id: TYPE_ID },
    ]);
    assert.deepEqual(rules.targetRefs('users', { id: USER_ID, username: 'ada' }), []);
    assert.deepEqual(rules.targetRefs('constructor', { id: USER_ID }), []);
  });

  test('every lookup reads the id column and nothing secret', () => {
    for (const [entity, spec] of Object.entries(rules.TARGET_SPECS)) {
      const columns = spec.columns.split(',').map((column) => column.trim());
      assert.equal(columns[0], 'id', entity);
      for (const column of columns) {
        assert.ok(!/password|pin|token|secret|account_number|submitted_fields|email|phone/.test(column), `${entity}.${column}`);
      }
    }
  });
});

describe('CSV export', () => {
  test('quotes cells and neutralises spreadsheet formulas', () => {
    assert.equal(rules.csvCell(null), '');
    assert.equal(rules.csvCell(undefined), '');
    assert.equal(rules.csvCell('=SUM(A1)'), `"'=SUM(A1)"`);
    assert.equal(rules.csvCell('@admin'), `"'@admin"`);
    assert.equal(rules.csvCell('say "hi"'), '"say ""hi"""');
    assert.equal(rules.csvCell({ a: 1 }), '"{""a"":1}"');
    assert.equal(rules.csvCell(true), '"true"');
  });

  test('keeps the original columns first, in order, and appends the new ones', () => {
    const header = rules.toCsv([]).split('\n')[0].split(',');
    assert.deepEqual(header.slice(0, 13), [
      'created_at', 'admin_username', 'admin_role_title', 'admin_is_super',
      'action', 'entity', 'entity_id', 'target_username', 'target_label',
      'ip_address', 'before_value', 'after_value', 'id',
    ]);
    for (const column of ['created_at_lagos', 'action_label', 'result', 'reason', 'error', 'sensitivity', 'request_id', 'user_agent']) {
      assert.ok(header.includes(column), column);
    }
  });

  test('writes one row per event with Lagos time and the human action', () => {
    const csv = rules.toCsv([event({ result: 'failure', reason: 'Fraud check', request_id: 'req_1' })]);
    const [, row] = csv.split('\n');
    const record = rules.exportRecord(event({ result: 'failure' }));
    assert.equal(record.created_at_lagos, '02 Oct 2026, 14:05:33');
    assert.equal(record.action_label, 'Approved withdrawal');
    assert.match(row, /"Approved withdrawal"/);
    assert.match(row, /"failure"/);
    assert.match(row, /"Fraud check"/);
    assert.match(row, /"req_1"/);
    assert.match(row, /"\{""status"":""processing""\}"/);
  });
});

describe('URL state and API queries', () => {
  test('reads every filter from the URL and drops malformed values', () => {
    const parsed = model.ACTIVITY_URL.parse(new URLSearchParams(
      `search=%20refund%20&admin=${ADMIN_ID}&action=APPROVE_WITHDRAWAL&entity=withdrawals&result=failure`
        + `&date_from=2026-10-01&date_to=2026-10-02&sort=created_at&dir=asc&page=3&id=${EVENT_ID}`,
    ));
    assert.equal(parsed.search, 'refund');
    assert.equal(parsed.admin, ADMIN_ID);
    assert.equal(parsed.action, 'APPROVE_WITHDRAWAL');
    assert.equal(parsed.entity, 'withdrawals');
    assert.equal(parsed.result, 'failure');
    assert.deepEqual(parsed.range, { from: '2026-10-01', to: '2026-10-02' });
    assert.deepEqual(parsed.sort, { key: 'created_at', dir: 'asc' });
    assert.equal(parsed.page, 3);
    assert.equal(parsed.id, EVENT_ID);

    const junk = model.ACTIVITY_URL.parse(new URLSearchParams(
      'admin=bob&action=approve&entity=Users)&result=maybe&date_from=2026-13-01&page=0&id=nope&sort=action',
    ));
    assert.equal(junk.admin, null);
    assert.equal(junk.action, '');
    assert.equal(junk.entity, '');
    assert.equal(junk.result, '');
    assert.deepEqual(junk.range, { from: null, to: null });
    assert.equal(junk.page, 1);
    assert.equal(junk.id, null);
    assert.deepEqual(junk.sort, { key: 'created_at', dir: 'desc' });
  });

  test('writes nothing to the URL for the default view', () => {
    assert.deepEqual(
      Object.values(model.ACTIVITY_URL.serialize(view())).filter((value) => value !== null),
      [],
    );
  });

  test('asks the API for one page with the route parameter names', () => {
    const query = new URLSearchParams(model.listQuery(view({
      search: 'ada',
      admin: ADMIN_ID,
      action: 'LOGIN_FAILED',
      entity: 'admin_users',
      result: 'unrecorded',
      range: { from: '2026-09-01', to: '2026-09-30' },
      page: 2,
    })));
    assert.equal(query.get('search'), 'ada');
    assert.equal(query.get('admin_id'), ADMIN_ID);
    assert.equal(query.get('action'), 'LOGIN_FAILED');
    assert.equal(query.get('entity'), 'admin_users');
    assert.equal(query.get('result'), 'unrecorded');
    assert.equal(query.get('date_from'), '2026-09-01');
    assert.equal(query.get('date_to'), '2026-09-30');
    assert.equal(query.get('page'), '2');
    assert.equal(query.get('limit'), String(rules.PAGE_SIZE));
    assert.equal(query.get('dir'), null);
    assert.equal(new URLSearchParams(model.listQuery(view({ sort: { key: 'created_at', dir: 'asc' } }))).get('dir'), 'asc');
  });

  test('exports the chosen window with the current filters and no paging', () => {
    const query = new URLSearchParams(model.exportQuery(
      view({ admin: ADMIN_ID, range: { from: '2026-09-01', to: '2026-09-30' }, page: 4 }),
      { from: '2026-10-01', to: '2026-10-02' },
      'pdf',
    ));
    assert.equal(query.get('export'), 'pdf');
    assert.equal(query.get('admin_id'), ADMIN_ID);
    assert.equal(query.get('date_from'), '2026-10-01');
    assert.equal(query.get('date_to'), '2026-10-02');
    assert.equal(query.get('page'), null);
    assert.equal(query.get('limit'), null);
  });

  test('describes the current filters for the export dialog', () => {
    const roster = [ADMIN];
    const current = view({ admin: ADMIN_ID, action: 'ENABLE_EMERGENCY_MODE', result: 'failure', search: 'mode' });
    assert.equal(
      model.describeFilters(current, roster),
      '@ops · Turned on emergency mode · Failed · search “mode”',
    );
    assert.equal(model.describeFilters(view(), roster), 'All admins');
    assert.equal(model.describeFilters(view({ admin: ADMIN_ID }), []), 'One admin');
    const option = model.exportFiltersFor(view({ range: { from: '2026-10-01', to: null } }), roster);
    assert.equal(option.label, 'Current filters');
    assert.equal(option.from, '2026-10-01');
    assert.equal(option.to, null);
  });

  test('knows when any filter is active', () => {
    assert.equal(model.isFiltered(view(), ''), false);
    assert.equal(model.isFiltered(view(), 'typing'), true);
    assert.equal(model.isFiltered(view({ result: 'partial' }), ''), true);
    assert.equal(model.isFiltered(view({ range: { from: null, to: '2026-10-01' } }), ''), true);
  });
});

describe('reading API responses', () => {
  test('parses a page of events and drops malformed rows', () => {
    const shown = event();
    const list = model.toListResult({
      success: true,
      activity: [shown, { id: 7 }, null, { ...shown, id: 'second', admin_is_super: 'yes' }],
      admins: [ADMIN, { username: 'no id' }],
      total: '120',
      search_capped: true,
      partial: { targets: 'Some targets could not be looked up.' },
    });
    assert.ok(list);
    assert.equal(list.events.length, 2);
    assert.equal(list.events[1].admin_is_super, false);
    assert.deepEqual(list.events[0].after_value, { status: 'processing' });
    assert.equal(list.admins.length, 1);
    assert.equal(list.total, 120);
    assert.equal(list.searchCapped, true);
    assert.equal(list.targetsNote, 'Some targets could not be looked up.');
    assert.equal(model.toListResult({ success: true }), null);
  });

  test('parses a single event and a print batch', () => {
    assert.equal(model.toEventResult({ event: event() })?.id, EVENT_ID);
    assert.equal(model.toEventResult({}), null);
    const batch = model.toPrintBatch({ success: true, rows: [rules.toPrintable(event()), 'junk'], total: 9, truncated: true });
    assert.ok(batch);
    assert.equal(batch.rows.length, 1);
    assert.equal(batch.total, 9);
    assert.equal(batch.truncated, true);
    assert.equal(model.toPrintBatch({ success: false, rows: [] }), null);
    assert.equal(model.toPrintBatch(null), null);
  });

  test('summarises the target without repeating the user handle', () => {
    assert.deepEqual(model.targetSummary({ entity: 'users', target_label: '@ada', target_username: 'ada' }), {
      primary: '@ada',
      secondary: 'User',
    });
    assert.deepEqual(
      model.targetSummary({ entity: 'withdrawals', target_label: '₦5,000.00 to GTBank', target_username: 'ada' }),
      { primary: '₦5,000.00 to GTBank', secondary: 'Withdrawal · @ada' },
    );
    assert.deepEqual(model.targetSummary({ entity: 'withdrawals', target_label: null, target_username: null }), {
      primary: 'Withdrawal',
      secondary: null,
    });
    assert.deepEqual(model.targetSummary({ entity: null, target_label: null, target_username: null }), {
      primary: '—',
      secondary: null,
    });
  });

  test('labels admins in the filter, including deleted and inactive ones', () => {
    assert.equal(model.adminOptionLabel(ADMIN), '@ops');
    assert.equal(model.adminOptionLabel({ ...ADMIN, deleted_at: STAMP }), '@ops (deleted admin)');
    assert.equal(model.adminOptionLabel({ ...ADMIN, is_active: false }), '@ops (inactive)');
    assert.equal(model.adminHandle(null), 'Unknown admin');
  });

  test('prints one readable row per event', () => {
    const cells = model.printCells(rules.toPrintable(event({ reason: 'Checked', request_id: 'req_9', admin_deleted: true })));
    assert.equal(cells.length, model.PRINT_COLUMNS.length);
    assert.deepEqual(cells, [
      '02 Oct 2026, 14:05:33',
      '@ops (deleted admin)',
      'Approved withdrawal',
      '₦5,000.00 to GTBank · Withdrawal · @ada',
      'Not recorded',
      'Checked',
      '102.89.4.10',
      'req_9',
    ]);
  });

  test('treats empty payloads as nothing recorded', () => {
    for (const empty of [null, undefined, '', '  ', [], {}]) assert.equal(model.hasRecordedValue(empty), false);
    for (const value of [0, false, 'x', [1], { a: 1 }]) assert.equal(model.hasRecordedValue(value), true);
  });
});

describe('event drawer', () => {
  const draw = (shown: ActivityEvent, userHref: string | null = null) =>
    render(createElement(parts.EventDetail, { event: shown, userHref }));

  test('shows the full event and masks account numbers in the payload', () => {
    const html = draw(event({
      user_agent: 'Mozilla/5.0 (Macintosh)',
      request_id: 'req_abc123',
      reason: 'Customer confirmed',
      sensitivity: 'financial',
      admin_role: 'Reviewer',
      after_value: { status: 'processing', account_number: '0123456789' },
    }), `/users/${USER_ID}`);
    const text = textOf(html);
    assert.ok(!html.includes('0123456789'));
    assert.ok(withClass(html, 'span', 'masked').length >= 1);
    for (const expected of [
      'Approved withdrawal', 'APPROVE_WITHDRAWAL', 'Financial', 'Customer confirmed', 'Reviewer',
      'Operations Lead', 'Mozilla/5.0 (Macintosh)', 'req_abc123', '102.89.4.10', 'WAT',
      '₦5,000.00 to GTBank', '@ada', 'Withdrawal',
    ]) {
      assert.ok(text.includes(expected), expected);
    }
    assert.ok(tagsOf(html, 'a').some((attrs) => attrs.href === `/users/${USER_ID}`));
  });

  test('leads with the error when an action failed or partly completed', () => {
    const failed = textOf(draw(event({ result: 'failure', error: 'Gateway timeout' })));
    assert.ok(failed.includes('This action did not complete'));
    assert.ok(failed.includes('Gateway timeout'));
    const partial = textOf(draw(event({ result: 'partial', error: null })));
    assert.ok(partial.includes('This action only partly completed'));
    assert.ok(partial.includes('No error message was recorded with this event.'));
    assert.ok(!textOf(draw(event())).includes('did not complete'));
  });

  test('says so when no before or after value was recorded', () => {
    const text = textOf(draw(event({ before_value: null, after_value: {} })));
    assert.ok(text.includes('No before or after values were recorded for this action.'));
    assert.ok(!textOf(draw(event())).includes('View user'));
  });

  test('marks super, deleted and unknown admins', () => {
    const named = textOf(render(createElement(parts.AdminName, {
      event: { admin_id: ADMIN_ID, admin_username: 'ops', admin_is_super: true, admin_deleted: true, action: 'LOGIN' },
    })));
    assert.ok(named.includes('@ops') && named.includes('Super') && named.includes('Deleted'));
    const unknown = textOf(render(createElement(parts.AdminName, {
      event: { admin_id: null, admin_username: null, admin_is_super: false, admin_deleted: false, action: 'LOGIN' },
    })));
    assert.equal(unknown, 'Unknown admin');
    assert.equal(textOf(render(createElement(parts.ResultDot, { value: null }))), 'Not recorded');
  });

  test('names the system as the actor of the purge record, never an unknown admin', () => {
    const system = render(createElement(parts.AdminName, {
      event: { admin_id: null, admin_username: null, admin_is_super: false, admin_deleted: false, action: rules.SYSTEM_ACTION },
    }));
    assert.equal(textOf(system), 'System');
    assert.equal(withClass(system, 'span', 'muted').length, 0);
    const claimed = textOf(render(createElement(parts.AdminName, {
      event: { admin_id: ADMIN_ID, admin_username: 'ops', admin_is_super: false, admin_deleted: false, action: rules.SYSTEM_ACTION },
    })));
    assert.equal(claimed, '@ops');
  });
});

describe('the deleted-account withdrawal purge record', () => {
  const COUNTS = {
    withdrawals: 3, transactions: 4, flagged_transactions: 1, anomaly_check_queue: 3, admin_alerts: 3, security_alerts: 1,
    notifications: 2,
  };
  const SUMMARY = 'Removed from deleted accounts after the retention period: 3 withdrawals, 4 transactions, '
    + '1 flagged transaction, 3 anomaly checks, 3 admin alerts, 1 security alert and 2 notifications.';
  const purge = (after: unknown = COUNTS): ActivityEvent => rules.presentEvent(
    stored({
      admin_id: null, action: rules.SYSTEM_ACTION, entity: 'withdrawals', entity_id: null, before_value: null,
      after_value: after, ip_address: null, result: 'success', sensitivity: 'financial',
    }),
    undefined,
    { username: null, label: null },
  );

  test('is written by the database with no admin, and is catalogued under System', { skip: !SIBLINGS_PRESENT }, () => {
    const writes = SQL_FILES.flatMap((file) => sqlUnattributedInserts(file)).filter((insert) => insert.actions.includes(rules.SYSTEM_ACTION));
    assert.equal(writes.length, 1);
    assert.ok(writes[0].at.startsWith(`${SQL_FILES[0]}:`), writes[0].at);
    assert.deepEqual(writes[0].actions, [rules.SYSTEM_ACTION]);
    const { sql, edge } = databaseAndEdgeInserts();
    assert.ok(![...sql, ...edge].some((insert) => insert.actions.includes(rules.SYSTEM_ACTION)));
    assert.ok(!consoleActions().actions.has(rules.SYSTEM_ACTION));
    assert.deepEqual(catalogueGaps([rules.SYSTEM_ACTION]), []);
    assert.equal(rules.actionLabel(rules.SYSTEM_ACTION), 'Deleted-account withdrawal data purged');
    const group = rules.ACTION_GROUPS.find((entry) => entry.label === 'System');
    assert.deepEqual(group?.options.map((option) => option.value), [rules.SYSTEM_ACTION]);
    assert.ok(rules.actionsMatching('withdrawal data').includes(rules.SYSTEM_ACTION));
  });

  test('describes every count the purge records, in plain words', { skip: !SIBLINGS_PRESENT }, () => {
    const sql = readFileSync(SQL_FILES[0], 'utf8');
    const start = sql.indexOf('CREATE OR REPLACE FUNCTION purge_deleted_account_withdrawals(');
    const body = sql.slice(start, sql.indexOf('$$;', start));
    const insert = body.slice(body.indexOf('INSERT INTO audit_log'));
    assert.match(insert, /^INSERT INTO audit_log \(action, entity, after_value, result, sensitivity\)/);
    const keys = [...insert.matchAll(/'([a-z_]+)', v_[a-z_]+/g)].map((match) => match[1]);
    assert.deepEqual(keys, Object.keys(COUNTS));
    assert.equal(rules.actionDescription(purge()), SUMMARY);
    for (const key of keys) {
      const partial = Object.fromEntries(Object.entries(COUNTS).filter(([name]) => name !== key));
      assert.equal(rules.actionDescription(purge(partial)), null, key);
    }
  });

  test('shows zero and large counts as recorded, and no summary for a malformed record or another action', () => {
    const zero = Object.fromEntries(Object.keys(COUNTS).map((key) => [key, 0]));
    assert.equal(
      rules.actionDescription(purge(zero)),
      'Removed from deleted accounts after the retention period: 0 withdrawals, 0 transactions, 0 flagged transactions, '
        + '0 anomaly checks, 0 admin alerts, 0 security alerts and 0 notifications.',
    );
    assert.match(rules.actionDescription(purge({ ...COUNTS, withdrawals: 12500 })) ?? '', /: 12,500 withdrawals, 4 transactions, /);
    for (const bad of [-1, 1.5, '3', null]) {
      assert.equal(rules.actionDescription(purge({ ...COUNTS, transactions: bad })), null, String(bad));
    }
    assert.equal(rules.actionDescription(purge(null)), null);
    assert.equal(rules.actionDescription(purge([3, 4])), null);
    assert.equal(rules.actionDescription({ action: 'APPROVE_WITHDRAWAL', after_value: COUNTS }), null);
  });

  test('names the system as the actor in the list, the drawer and the printout', () => {
    const shown = purge();
    assert.equal(rules.isSystemEvent(shown), true);
    assert.equal(model.actorName(shown), 'System');
    assert.equal(rules.isSystemEvent({ admin_id: null, action: 'APPROVE_WITHDRAWAL' }), false);
    assert.equal(rules.isSystemEvent({ admin_id: ADMIN_ID, action: rules.SYSTEM_ACTION }), false);
    assert.equal(model.actorName(event({ admin_id: null, admin_username: null })), 'Unknown admin');
    const cells = model.printCells(rules.toPrintable(shown));
    assert.deepEqual(cells.slice(1, 5), ['System', 'Deleted-account withdrawal data purged', 'Withdrawal', 'Succeeded']);
    const text = textOf(render(createElement(parts.EventDetail, { event: rules.forScreen(shown), userHref: null })));
    for (const expected of [
      'Deleted-account withdrawal data purged', rules.SYSTEM_ACTION, 'Summary', SUMMARY, 'System', 'Financial', 'Withdrawal',
    ]) {
      assert.ok(text.includes(expected), expected);
    }
    assert.ok(!text.includes('Unknown admin'));
    assert.ok(!textOf(render(createElement(parts.EventDetail, { event: event(), userHref: null }))).includes('Summary'));
    const page = readFileSync(join(OWNED_DIR, 'page.tsx'), 'utf8');
    assert.match(
      page,
      /\{isSystemEvent\(event\) \? null : \(\s*<span className=\{s\.sub\}>\{event\.admin_role \|\| event\.admin_role_title \|\| 'Role not recorded'\}<\/span>\s*\)\}/,
    );
    assert.match(page, /secondary: `\$\{actorName\(event\)\} · \$\{target\.primary\}`/);
    assert.match(page, /WAT · \$\{actorName\(shownEvent\)\}`/);
    assert.doesNotMatch(page, /adminHandle\(/);
  });

  test('reads the record back from an API response unchanged', () => {
    const list = model.toListResult({ success: true, activity: [rules.forScreen(purge())], admins: [], total: 1 });
    assert.ok(list);
    assert.equal(list.events.length, 1);
    assert.equal(model.actorName(list.events[0]), 'System');
    assert.equal(rules.actionDescription(list.events[0]), SUMMARY);
    assert.equal(model.toEventResult({ event: rules.forScreen(purge()) })?.admin_id, null);
  });
});

describe('route contract', () => {
  const source = readFileSync(ROUTE_FILE, 'utf8');

  test('opens the log on audit.read and exports only with audit.export, never on the raw Admin Activity key (D-19)', () => {
    assert.match(source, /const guard = await requireAdmin\('audit\.read'\);\s*if \(!guard\.ok\) return guard\.response;/);
    assert.equal((source.match(/requireAdmin\(/g) ?? []).length, 1);
    assert.doesNotMatch(source, /requireActivityAccess|ACTIVITY_GRANT|page_permissions|requireSuperAdmin|requireAdminAny|requireAdminAll/);
    assert.ok(!('ACTIVITY_GRANT' in rules));
    const exporter = source.slice(source.indexOf('async function exportEvents('), source.indexOf('async function legacyList('));
    assert.match(exporter, /^async function exportEvents\([^)]*\) \{\s*if \(!admin\.can\('audit\.export'\)\) \{\s*return fail\(/);
    assert.match(
      exporter,
      /return fail\('PERMISSION_DENIED', EXPORT_DENIED, \{ details: \{ required: \['audit\.export'\] \} \}\);\s*\}\s*const parsed = parseFilters/,
    );
    assert.match(source, /const EXPORT_DENIED = 'Exporting the activity log needs the “Export audit log” permission\.';/);
    assert.equal((source.match(/return exportEvents\(admin, /g) ?? []).length, 2);
    assert.doesNotMatch(source, /AUTH_REQUIRED|status: 401/);
  });

  test('the database list behind the mobile app’s request checks audit.read as well', { skip: !SIBLINGS_PRESENT }, () => {
    const sql = readFileSync(SQL_FILES[1], 'utf8');
    const list = sql.slice(sql.indexOf('CREATE OR REPLACE FUNCTION list_admin_activity('));
    const body = list.slice(0, list.indexOf('$$;'));
    assert.match(body, /IF NOT \(v_super = TRUE OR 'audit\.read' = ANY \(admin_expand_grants\(v_perms\)\)\) THEN/);
    assert.doesNotMatch(body, /'activity' = ANY/);
    assert.match(source, /if \(\/forbidden\/i\.test\(listed\.error\.message \|\| ''\)\) return fail\('PERMISSION_DENIED', DENIED\);/);
  });

  test('lists admin rows plus exactly one system action, the deleted-account purge, and keeps every other filter', () => {
    assert.equal(rules.SYSTEM_ACTION, 'PURGE_DELETED_ACCOUNT_WITHDRAWALS');
    assert.match(source, /^const ADMIN_OR_SYSTEM = `admin_id\.not\.is\.null,action\.eq\.\$\{SYSTEM_ACTION\}`;$/m);
    assert.doesNotMatch(source, /\.not\('admin_id'/);
    assert.equal((source.match(/\.or\(ADMIN_OR_SYSTEM\)/g) ?? []).length, 2);
    const scope = source.slice(source.indexOf('function scoped('), source.indexOf('async function fetchTargetRows('));
    assert.match(scope, /let query = supabaseAdmin\.from\('audit_log'\)\.select\(columns, \{ count, head \}\)\.or\(ADMIN_OR_SYSTEM\);/);
    for (const kept of [
      "if (filters.adminId) query = query.eq('admin_id', filters.adminId);",
      "if (filters.entity) query = query.eq('entity', filters.entity);",
      "if (filters.result === 'unrecorded') query = query.is('result', null).is(META_RESULT, null);",
      "if (filters.fromIso) query = query.gte('created_at', filters.fromIso);",
      "if (filters.through) query = query.lte('created_at', filters.through);",
      'if (clause) query = query.or(clause);',
    ]) {
      assert.ok(scope.includes(kept), kept);
    }
    const reader = source.slice(source.indexOf('async function readEvent('), source.indexOf('async function prepareSearch('));
    assert.match(reader, /\.eq\('id', id\.toLowerCase\(\)\)\s*\.or\(ADMIN_OR_SYSTEM\)\s*\.limit\(1\),/);
  });

  test('the database list behind the mobile app admits the same system action and keeps its filters', { skip: !SIBLINGS_PRESENT }, () => {
    const sql = readFileSync(SQL_FILES[1], 'utf8');
    const list = sql.slice(sql.indexOf('CREATE OR REPLACE FUNCTION list_admin_activity('));
    const body = list.slice(0, list.indexOf('$$;'));
    assert.equal(body.slice(body.indexOf('  FROM audit_log al'), body.indexOf('  ORDER BY al.created_at DESC')), [
      '  FROM audit_log al',
      '  LEFT JOIN admin_users u ON u.id = al.admin_id',
      `  WHERE (al.admin_id IS NOT NULL OR al.action = '${rules.SYSTEM_ACTION}')`,
      '    AND (p_before IS NULL OR al.created_at < p_before)',
      '    AND (p_after  IS NULL OR al.created_at >= p_after)',
      '    AND (p_admin_filter IS NULL OR al.admin_id = p_admin_filter)',
      '',
    ].join('\n'));
  });

  test('still answers the mobile app’s request shape', () => {
    for (const name of ['admin_id', 'admin_filter', 'limit', 'before', 'after']) {
      assert.match(source, new RegExp(`'${name}'`), name);
    }
    assert.match(source, /list_admin_activity/);
    assert.match(source, /ok\(\{ activity, admins \}\)/);
    assert.equal(rules.LEGACY_MAX_LIMIT, 200);
  });

  test('audits every export and refuses one it cannot record', () => {
    assert.match(source, /EXPORT_CSV/);
    assert.match(source, /EXPORT_PDF/);
    assert.match(source, /entity: 'audit_log'/);
    assert.match(source, /sensitivity: 'sensitive'/);
    assert.match(source, /fail\('AUDIT_FAILED'/);
  });

  test('filters dates on Lagos day boundaries and sanitises search', () => {
    assert.match(source, /lagosDateToRangeStart/);
    assert.match(source, /lagosDateToRangeEnd/);
    assert.match(source, /sanitizeSearch/);
  });
});

describe('hard rules for the activity files', () => {
  test('no prose comments, literal colours, stacking numbers or static inline styles', () => {
    for (const file of ownedSources()) {
      const text = readFileSync(file, 'utf8');
      assert.ok(!/\/\*|(^|[^:])\/\/(?!\/)/m.test(text), `${file} has a comment`);
      assert.ok(!/#[0-9a-f]{3,8}\b|\brgba?\(|\bhsla?\(/i.test(text), `${file} has a literal colour`);
      assert.ok(!/z-?index/i.test(text), `${file} sets a stacking order`);
      assert.ok(!/style=\{\{/.test(text), `${file} has a static inline style`);
    }
    const css = readFileSync(join(OWNED_DIR, 'page.module.css'), 'utf8');
    assert.ok(!/\/\*/.test(css));
    assert.ok(!/#[0-9a-f]{3,8}\b|\brgba?\(|\bhsla?\(|z-index/i.test(css));
  });

  test('client modules say so, and the browser-local export window is gone', () => {
    const page = readFileSync(join(OWNED_DIR, 'page.tsx'), 'utf8');
    const partsSource = readFileSync(join(OWNED_DIR, 'ActivityParts.tsx'), 'utf8');
    assert.ok(page.startsWith("'use client';"));
    assert.ok(partsSource.startsWith("'use client';"));
    assert.doesNotMatch(page, /rangeBounds|RangeKey|useIsMobile|ActivityMobile|toLocaleString\(\)/);
    assert.match(page, /resolveExportRange/);
    assert.match(page, /useUrlState/);
    assert.match(page, /useCan\('audit\.export'\)/);
  });
});
