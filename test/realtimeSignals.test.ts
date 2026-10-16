import { afterEach, before, beforeEach, describe, mock, test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createElement, type Context } from 'react';
import ts from 'typescript';
import { loadAppModule, loadUi, render } from './support/uiHarness.ts';
import type { ApiFailureKind, ApiResult } from '../app/lib/apiClient.ts';
import type {
  ChannelStatus, RealtimeSignal, SignalsEngine, SignalsEnvironment, SignalsTransport, SignalTopic,
} from '../app/_ui/realtime/signalsCore.ts';
import type { ShellProps } from '../app/(dashboard)/_shell/Shell.tsx';

type CoreModule = typeof import('../app/_ui/realtime/signalsCore.ts');
type SignalsModule = typeof import('../app/_ui/realtime/RealtimeSignals.tsx');
type TransportModule = typeof import('../app/_ui/realtime/supabaseTransport.ts');
type ShellModule = typeof import('../app/(dashboard)/_shell/Shell.tsx');
type ThemeModule = typeof import('../app/_ui/theme.tsx');

const ADMIN_DIR = fileURLToPath(new URL('../', import.meta.url));
const APP_DIR = join(ADMIN_DIR, 'app');
const UI_DIR = join(APP_DIR, '_ui');
const REALTIME_DIR = join(UI_DIR, 'realtime');
const CORE_FILE = join(REALTIME_DIR, 'signalsCore.ts');
const TRANSPORT_FILE = join(REALTIME_DIR, 'supabaseTransport.ts');
const PROVIDER_FILE = join(REALTIME_DIR, 'RealtimeSignals.tsx');
const SHELL_FILE = join(APP_DIR, '(dashboard)', '_shell', 'Shell.tsx');
const UI_INDEX_FILE = join(UI_DIR, 'index.ts');
const PASS_LIB_FILE = join(APP_DIR, 'lib', 'realtimePass.ts');
const PASS_ROUTE_FILE = join(APP_DIR, 'api', 'realtime', 'pass', 'route.ts');
const SUPABASE_LIB_FILE = join(APP_DIR, 'lib', 'supabase.ts');
const TEST_FILE = fileURLToPath(import.meta.url);
const SCHEMA_FILE = fileURLToPath(new URL('../../schema_admin_app.sql', import.meta.url));
const IMPORT_RE = /^((?:import|export)\b[^;'"]*?\bfrom\s*|import\s*)['"]([^'"]+)['"]/gm;
const STATIC_IMPORT_RE = /^(?:import|export)\s+(type\s+)?([^;'"]*?)\s*\bfrom\s*['"]([^'"]+)['"]|^import\s*['"]([^'"]+)['"]/gm;
const SUPABASE_JS = import.meta.resolve('@supabase/supabase-js');
const nodeRequire = createRequire(import.meta.url);

const SUPABASE_URL = 'https://project.supabase.test';
const PUBLISHABLE_KEY = 'sb_publishable_signalsTestKey0123456789';
const BOTH_TOPICS = ['admin:withdrawals', 'admin:cards'] as const;
const CARD_ID = '6a1f0c2e-9b3d-4e5f-8a7b-0c1d2e3f4a5b';
const WITHDRAWAL_ID = '1b2c3d4e-5f60-4718-9a0b-c1d2e3f4a5b6';
const FLAG_ID = '9f8e7d6c-5b4a-4392-8170-6f5e4d3c2b1a';
const DENIED = 'Unauthorized: You do not have permissions to read from this Channel topic: admin:cards';
const SIGNATURE_REFUSAL = 'JwtSignatureError: Failed to validate JWT signature';
const ISSUED_AT = 1_760_000_000;
const HOUR_MS = 60 * 60 * 1000;

let core: CoreModule;
let signals: SignalsModule;
let transports: TransportModule;

const sources = new Map<string, string>();

function read(file: string): string {
  let text = sources.get(file);
  if (text === undefined) {
    text = readFileSync(file, 'utf8');
    sources.set(file, text);
  }
  return text;
}

function rel(file: string): string {
  return relative(ADMIN_DIR, file).split(sep).join('/');
}

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(path));
    else if (/\.(?:tsx?|mts)$/.test(entry.name)) out.push(path);
  }
  return out;
}

function staticImports(source: string): string[] {
  const out: string[] = [];
  for (const [, typeOnly, clause, from, bare] of source.matchAll(STATIC_IMPORT_RE)) {
    if (bare) {
      out.push(bare);
      continue;
    }
    if (typeOnly) continue;
    const named = clause.match(/^\{([^}]*)\}$/);
    const parts = named ? named[1].split(',').map((part) => part.trim()).filter(Boolean) : [];
    if (named && parts.length > 0 && parts.every((part) => part.startsWith('type '))) continue;
    out.push(from);
  }
  return out;
}

function findSource(fromFile: string, specifier: string): string | null {
  const base = resolve(dirname(fromFile), specifier);
  const candidates = /\.(?:tsx?|mts)$/.test(base)
    ? [base]
    : [`${base}.ts`, `${base}.tsx`, join(base, 'index.ts'), join(base, 'index.tsx')];
  return candidates.find((candidate) => existsSync(candidate)) ?? null;
}

function staticGraph(entry: string): { files: Set<string>; packages: Set<string> } {
  const files = new Set<string>([entry]);
  const packages = new Set<string>();
  const queue = [entry];
  for (let index = 0; index < queue.length; index += 1) {
    const file = queue[index];
    for (const specifier of staticImports(read(file))) {
      if (!specifier.startsWith('.')) {
        packages.add(specifier);
        continue;
      }
      const target = findSource(file, specifier);
      if (!target || files.has(target)) continue;
      files.add(target);
      queue.push(target);
    }
  }
  return { files, packages };
}

function moduleUrl(source: string): string {
  return `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
}

const bundles = new Map<string, Promise<string>>();

async function transpile(file: string): Promise<string> {
  const { outputText } = ts.transpileModule(readFileSync(file, 'utf8'), {
    fileName: file,
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022, verbatimModuleSyntax: false },
  });
  const targets = new Map<string, string>();
  for (const [, , specifier] of outputText.matchAll(IMPORT_RE)) {
    if (targets.has(specifier)) continue;
    if (specifier.startsWith('.')) {
      const target = findSource(file, specifier);
      if (!target) throw new Error(`${file} imports ${specifier}, which does not resolve`);
      targets.set(specifier, await bundle(target));
    } else if (specifier === '@supabase/supabase-js') {
      targets.set(specifier, SUPABASE_JS);
    } else {
      throw new Error(`${file} imports ${specifier}, which this test does not provide`);
    }
  }
  return moduleUrl(outputText.replace(IMPORT_RE, (match: string, head: string, specifier: string) => {
    const target = targets.get(specifier);
    return target ? `${head}'${target}'` : match;
  }));
}

function bundle(file: string): Promise<string> {
  let pending = bundles.get(file);
  if (!pending) {
    pending = transpile(file);
    bundles.set(file, pending);
  }
  return pending;
}

async function settle(rounds = 6): Promise<void> {
  for (let round = 0; round < rounds; round += 1) {
    await new Promise<void>((done) => setImmediate(done));
  }
}

interface Clock {
  readonly env: SignalsEnvironment;
  hidden: boolean;
  now: () => number;
  advance: (ms: number) => Promise<void>;
  setHidden: (hidden: boolean) => void;
  timers: () => number;
}

function createClock(log: string[]): Clock {
  let now = 1000;
  let sequence = 0;
  const pending = new Map<number, { at: number; callback: () => void }>();
  const visibility = new Set<() => void>();
  const clock: Clock = {
    hidden: false,
    now: () => now,
    env: {
      now: () => now,
      setTimer: (callback, ms) => {
        sequence += 1;
        pending.set(sequence, { at: now + ms, callback });
        log.push(`timer ${ms}`);
        return sequence;
      },
      clearTimer: (handle) => {
        pending.delete(handle as number);
      },
      isHidden: () => clock.hidden,
      onVisibility: (callback) => {
        visibility.add(callback);
        return () => {
          visibility.delete(callback);
        };
      },
    },
    advance: async (ms) => {
      const target = now + ms;
      await settle();
      for (;;) {
        const due = [...pending]
          .filter(([, timer]) => timer.at <= target)
          .sort((a, b) => a[1].at - b[1].at || a[0] - b[0]);
        if (due.length === 0) break;
        const [id, timer] = due[0];
        pending.delete(id);
        now = Math.max(now, timer.at);
        timer.callback();
        await settle();
      }
      now = target;
      await settle();
    },
    setHidden: (hidden) => {
      clock.hidden = hidden;
      for (const callback of Array.from(visibility)) callback();
    },
    timers: () => pending.size,
  };
  return clock;
}

interface JoinRecord {
  topic: string;
  at: number;
  onMessage: (payload: unknown) => void;
  onStatus: (status: ChannelStatus, reason: string | null) => void;
}

class FakeTransport implements SignalsTransport {
  readonly joins: JoinRecord[] = [];
  connectGate: Promise<void> | null = null;
  failConnect = false;
  private readonly log: string[];
  private readonly clock: Clock;

  constructor(log: string[], clock: Clock) {
    this.log = log;
    this.clock = clock;
  }

  async connect(url: string, key: string, token: string): Promise<void> {
    this.log.push(`connect ${token}`);
    if (this.connectGate) await this.connectGate;
    if (this.failConnect) throw new Error('connect refused');
  }

  async setAuth(token: string): Promise<void> {
    this.log.push(`setAuth ${token}`);
  }

  join(
    topic: string,
    onMessage: (payload: unknown) => void,
    onStatus: (status: ChannelStatus, reason: string | null) => void,
  ): void {
    this.log.push(`join ${topic}`);
    this.joins.push({ topic, at: this.clock.now(), onMessage, onStatus });
  }

  async leave(topic: string): Promise<void> {
    this.log.push(`leave ${topic}`);
  }

  async disconnect(): Promise<void> {
    this.log.push('disconnect');
  }

  joinsOf(topic: string): JoinRecord[] {
    return this.joins.filter((entry) => entry.topic === topic);
  }

  latest(topic: string): JoinRecord {
    const found = this.joinsOf(topic).at(-1);
    assert.ok(found, `no join for ${topic}`);
    return found;
  }
}

interface Harness {
  engine: SignalsEngine;
  clock: Clock;
  transport: FakeTransport;
  log: string[];
  requests: () => number;
  loads: () => number;
  answer: (result: ApiResult<unknown>) => Promise<void>;
}

function setup(options: { loadFails?: boolean } = {}): Harness {
  const log: string[] = [];
  const clock = createClock(log);
  const transport = new FakeTransport(log, clock);
  const waiting: Array<(result: ApiResult<unknown>) => void> = [];
  let requests = 0;
  let loads = 0;
  const engine = new core.SignalsEngine({
    environment: clock.env,
    fetchPass: () => {
      requests += 1;
      log.push('pass');
      return new Promise<ApiResult<unknown>>((done) => {
        waiting.push(done);
      });
    },
    loadTransport: async () => {
      loads += 1;
      log.push('load');
      if (options.loadFails) throw new Error('chunk failed to load');
      return transport;
    },
  });
  return {
    engine,
    clock,
    transport,
    log,
    requests: () => requests,
    loads: () => loads,
    answer: async (result) => {
      const next = waiting.shift();
      assert.ok(next, 'a pass request is waiting');
      next(result);
      await settle();
    },
  };
}

interface PassShape {
  topics?: readonly string[];
  lifetime?: number;
  issuedAt?: number;
  url?: string;
}

interface GrantedPass {
  token: string;
  result: ApiResult<unknown>;
}

let minted = 0;

function granted(shape: PassShape = {}): GrantedPass {
  minted += 1;
  const token = `eyJhbGciOiJIUzI1NiJ9.cGFzcw${minted}.c2lnbmF0dXJl${minted}`;
  const issuedAt = shape.issuedAt ?? ISSUED_AT;
  return {
    token,
    result: {
      ok: true,
      status: 200,
      requestId: 'req_pass',
      data: {
        success: true,
        request_id: 'req_pass',
        enabled: true,
        url: shape.url ?? SUPABASE_URL,
        key: PUBLISHABLE_KEY,
        token,
        issued_at: issuedAt,
        expires_at: issuedAt + (shape.lifetime ?? 300),
        topics: [...(shape.topics ?? BOTH_TOPICS)],
      },
    },
  };
}

function passWith(patch: Record<string, unknown>): ApiResult<unknown> {
  const base = granted().result;
  assert.ok(base.ok);
  const data: Record<string, unknown> = { ...(base.data as Record<string, unknown>) };
  for (const [name, value] of Object.entries(patch)) {
    if (value === undefined) delete data[name];
    else data[name] = value;
  }
  return { ...base, data };
}

function switchedOff(): ApiResult<unknown> {
  return { ok: true, status: 200, requestId: 'req_pass', data: { success: true, request_id: 'req_pass', enabled: false } };
}

function failure(status: number | null, kind: ApiFailureKind = 'http'): ApiResult<unknown> {
  return {
    ok: false,
    error: { kind, status, code: null, message: `failed ${status ?? kind}`, requestId: null, details: null, outcomeUnknown: false },
  };
}

function change(table: string, id: string, status: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return { v: 1, table, id, status, ...extra };
}

async function goLive(
  h: Harness,
  topics: readonly SignalTopic[],
  pass: GrantedPass = granted(),
): Promise<Record<SignalTopic, RealtimeSignal[]>> {
  const seen: Record<SignalTopic, RealtimeSignal[]> = { withdrawals: [], cards: [] };
  for (const topic of topics) {
    h.engine.subscribe(topic, (signal) => {
      seen[topic].push(signal);
    });
  }
  await settle();
  await h.answer(pass.result);
  for (const topic of topics) h.transport.latest(core.SIGNAL_TOPICS[topic]).onStatus('SUBSCRIBED', null);
  await settle();
  for (const topic of topics) assert.equal(h.engine.status(topic), 'live', topic);
  return seen;
}

function since(log: string[], start: number): string[] {
  return log.slice(start).filter((entry) => !entry.startsWith('timer '));
}

interface Frame {
  joinRef: string | null;
  ref: string | null;
  topic: string;
  event: string;
  payload: Record<string, unknown>;
}

type Reply = Record<string, unknown> | null;

class FakeSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;
  static sockets: FakeSocket[] = [];
  static joinReply: (frame: Frame) => Reply = () => ({ status: 'ok', response: {} });

  readonly url: string;
  readonly frames: Frame[] = [];
  readyState = 0;
  bufferedAmount = 0;
  binaryType = 'blob';
  onopen: ((event: unknown) => void) | null = null;
  onclose: ((event: unknown) => void) | null = null;
  onerror: ((event: unknown) => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;

  constructor(url: string | URL) {
    this.url = String(url);
    FakeSocket.sockets.push(this);
    queueMicrotask(() => {
      if (this.readyState !== 0) return;
      this.readyState = 1;
      this.onopen?.({});
    });
  }

  send(data: string): void {
    const [joinRef, ref, topic, event, payload] = JSON.parse(data) as [
      string | null, string | null, string, string, Record<string, unknown>,
    ];
    const frame: Frame = { joinRef, ref, topic, event, payload };
    this.frames.push(frame);
    const reply: Reply = event === 'phx_join'
      ? FakeSocket.joinReply(frame)
      : event === 'phx_leave' || event === 'heartbeat' ? { status: 'ok', response: {} } : null;
    if (reply) queueMicrotask(() => this.deliver([joinRef, ref, topic, 'phx_reply', reply]));
  }

  deliver(message: unknown[]): void {
    if (this.readyState === 1) this.onmessage?.({ data: JSON.stringify(message) });
  }

  close(code = 1000, reason = ''): void {
    if (this.readyState >= 2) return;
    this.readyState = 3;
    queueMicrotask(() => this.onclose?.({ code, reason, wasClean: true }));
  }

  drop(): void {
    this.readyState = 3;
    this.onclose?.({ code: 1006, reason: 'connection lost', wasClean: false });
  }
}

function framesOf(event: string): Frame[] {
  return FakeSocket.sockets.flatMap((socket) => socket.frames.filter((frame) => frame.event === event));
}

function recorder() {
  const statuses: Array<[ChannelStatus, string | null]> = [];
  const payloads: unknown[] = [];
  return {
    statuses,
    payloads,
    onMessage: (payload: unknown) => {
      payloads.push(payload);
    },
    onStatus: (status: ChannelStatus, reason: string | null) => {
      statuses.push([status, reason]);
    },
  };
}

async function tickFor(ms: number): Promise<void> {
  for (let elapsed = 0; elapsed < ms; elapsed += 5000) {
    mock.timers.tick(5000);
    await settle();
  }
}

before(async () => {
  core = await loadUi<CoreModule>('realtime/signalsCore.ts');
  signals = await loadUi<SignalsModule>('realtime/RealtimeSignals.tsx');
  transports = (await import(await bundle(TRANSPORT_FILE))) as TransportModule;
});

describe('signal payloads', () => {
  test('only the payload the trigger builds passes, on the topic the trigger sends it on, and only its known fields survive', () => {
    assert.deepEqual(core.readSignal(change('card_submissions', CARD_ID, 'pending'), 'cards'), {
      kind: 'signal', table: 'card_submissions', id: CARD_ID, status: 'pending',
    });
    assert.deepEqual(core.readSignal(change('withdrawals', WITHDRAWAL_ID, 'pending_review'), 'withdrawals'), {
      kind: 'signal', table: 'withdrawals', id: WITHDRAWAL_ID, status: 'pending_review',
    });
    assert.deepEqual(
      core.readSignal(change('flagged_transactions', FLAG_ID, 'cleared', { withdrawal_id: WITHDRAWAL_ID }), 'withdrawals'),
      { kind: 'signal', table: 'flagged_transactions', id: FLAG_ID, status: 'cleared', withdrawalId: WITHDRAWAL_ID },
    );
    assert.deepEqual(
      core.readSignal(change('card_submissions', CARD_ID, 'approved', { amount: 5000, user_id: WITHDRAWAL_ID }), 'cards'),
      { kind: 'signal', table: 'card_submissions', id: CARD_ID, status: 'approved' },
    );
    assert.equal(core.readSignal(change('card_submissions', CARD_ID, 'pending'), 'withdrawals'), null);
    assert.equal(core.readSignal(change('withdrawals', WITHDRAWAL_ID, 'held'), 'cards'), null);
    assert.equal(core.readSignal(change('flagged_transactions', FLAG_ID, 'cleared', { withdrawal_id: WITHDRAWAL_ID }), 'cards'), null);
  });

  test('anything malformed is dropped, including the canary probe', () => {
    const card = change('card_submissions', CARD_ID, 'pending');
    const dropped: Array<[unknown, SignalTopic]> = [
      [null, 'cards'],
      ['changed', 'cards'],
      [[card], 'cards'],
      [{ ...card, v: 2 }, 'cards'],
      [{ ...card, v: '1' }, 'cards'],
      [{ table: 'card_submissions', id: CARD_ID, status: 'pending' }, 'cards'],
      [change('probe', '00000000-0000-0000-0000-000000000000', 'probe'), 'cards'],
      [{ ...card, table: 'users' }, 'cards'],
      [{ ...card, id: 'not-a-uuid' }, 'cards'],
      [{ ...card, id: 42 }, 'cards'],
      [{ ...card, status: 'Pending' }, 'cards'],
      [{ ...card, status: 'a'.repeat(33) }, 'cards'],
      [{ ...card, status: 'pending review' }, 'cards'],
      [{ ...card, status: '' }, 'cards'],
      [{ ...card, status: null }, 'cards'],
      [change('flagged_transactions', FLAG_ID, 'cleared'), 'withdrawals'],
      [change('flagged_transactions', FLAG_ID, 'cleared', { withdrawal_id: 'W-1' }), 'withdrawals'],
      [change('flagged_transactions', FLAG_ID, 'cleared', { withdrawal_id: null }), 'withdrawals'],
      [change('withdrawals', WITHDRAWAL_ID, 'held', { withdrawal_id: 'nope' }), 'withdrawals'],
    ];
    for (const [payload, topic] of dropped) assert.equal(core.readSignal(payload, topic), null, JSON.stringify(payload));
  });
});

describe('pass answers', () => {
  test('a granted pass keeps the lifetime the server set and is renewed at 80 per cent of it, whatever the browser clock says', () => {
    const pass = granted();
    assert.deepEqual(core.readPass(pass.result, 10_000), {
      kind: 'pass',
      pass: {
        url: SUPABASE_URL,
        key: PUBLISHABLE_KEY,
        token: pass.token,
        topics: ['admin:withdrawals', 'admin:cards'],
        receivedAt: 10_000,
        renewAt: 250_000,
        expiresAt: 310_000,
      },
    });
    const short = core.readPass(granted({ lifetime: 100 }).result, 5_000);
    assert.equal(short.kind, 'pass');
    if (short.kind === 'pass') assert.deepEqual([short.pass.renewAt, short.pass.expiresAt], [85_000, 105_000]);
    const clockless = core.readPass(passWith({ issued_at: undefined, expires_at: ISSUED_AT + 300 }), ISSUED_AT * 1000);
    assert.equal(clockless.kind, 'pass');
    if (clockless.kind === 'pass') assert.equal(clockless.pass.expiresAt - clockless.pass.receivedAt, 300_000);
    const topics = core.readPass(passWith({ topics: ['admin:cards', 'admin:other', 'admin:cards', 7] }), 0);
    assert.equal(topics.kind, 'pass');
    if (topics.kind === 'pass') assert.deepEqual(topics.pass.topics, ['admin:cards']);
  });

  test('switched off, malformed and refused answers turn realtime off for the page load', () => {
    const off = { kind: 'off', reason: 'disabled' };
    const malformed: Array<Record<string, unknown>> = [
      { url: 'http://project.supabase.test' },
      { url: 'not a url' },
      { url: undefined },
      { key: '' },
      { key: '   ' },
      { key: undefined },
      { token: 'not-a-jwt' },
      { token: undefined },
      { topics: 'admin:cards' },
      { topics: undefined },
      { expires_at: String(ISSUED_AT + 300) },
      { expires_at: ISSUED_AT + 300.5 },
      { issued_at: null },
      { expires_at: ISSUED_AT },
      { expires_at: ISSUED_AT - 10 },
      { expires_at: ISSUED_AT + 3601 },
      { enabled: 'true' },
    ];
    for (const patch of malformed) assert.deepEqual(core.readPass(passWith(patch), 0), off, JSON.stringify(patch));
    assert.deepEqual(core.readPass(switchedOff(), 0), off);
    assert.deepEqual(core.readPass({ ok: true, status: 200, requestId: null, data: 'yes' }, 0), off);
    assert.deepEqual(core.readPass(failure(401), 0), { kind: 'off', reason: 'signed-out' });
    assert.deepEqual(core.readPass(failure(403), 0), { kind: 'off', reason: 'denied' });
    for (const status of [400, 404, 409]) assert.deepEqual(core.readPass(failure(status), 0), off, String(status));
  });

  test('outages, rate limits and interrupted requests are retried', () => {
    for (const status of [429, 500, 502, 503]) assert.deepEqual(core.readPass(failure(status), 0), { kind: 'retry' }, String(status));
    for (const kind of ['network', 'timeout', 'parse', 'aborted'] as const) {
      assert.deepEqual(core.readPass(failure(null, kind), 0), { kind: 'retry' }, kind);
    }
  });
});

describe('the signals engine', () => {
  test('the first consumer asks for one pass, loads the transport once, and joins only after connect has taken that pass', async () => {
    const h = setup();
    let open: () => void = () => {};
    h.transport.connectGate = new Promise<void>((done) => {
      open = done;
    });
    h.engine.subscribe('cards', () => {});
    await settle();
    assert.equal(h.requests(), 1);
    assert.equal(h.loads(), 0);
    assert.equal(h.engine.status('cards'), 'connecting');
    const pass = granted();
    await h.answer(pass.result);
    assert.deepEqual(since(h.log, 0), ['pass', 'load', `connect ${pass.token}`]);
    assert.equal(h.transport.joins.length, 0);
    open();
    await settle();
    assert.deepEqual(h.transport.joins.map((entry) => entry.topic), ['admin:cards']);
    h.engine.subscribe('withdrawals', () => {});
    await settle();
    assert.deepEqual(h.transport.joins.map((entry) => entry.topic), ['admin:cards', 'admin:withdrawals']);
    assert.equal(h.requests(), 1);
    assert.equal(h.loads(), 1);
    assert.equal(h.log.filter((entry) => entry.startsWith('connect ')).length, 1);
    assert.equal(h.engine.status('cards'), 'connecting');
  });

  test('one channel per topic however many consumers, each SUBSCRIBED sends one resync, and changes reach every consumer of the topic', async () => {
    const h = setup();
    const first: RealtimeSignal[] = [];
    const second: RealtimeSignal[] = [];
    const flags: RealtimeSignal[] = [];
    h.engine.subscribe('cards', (signal) => {
      first.push(signal);
    });
    h.engine.subscribe('cards', (signal) => {
      second.push(signal);
    });
    h.engine.subscribe('withdrawals', (signal) => {
      flags.push(signal);
    });
    await settle();
    await h.answer(granted().result);
    assert.deepEqual(h.transport.joins.map((entry) => entry.topic), ['admin:withdrawals', 'admin:cards']);
    h.transport.latest('admin:cards').onStatus('SUBSCRIBED', null);
    h.transport.latest('admin:withdrawals').onStatus('SUBSCRIBED', null);
    await settle();
    assert.equal(h.engine.status('cards'), 'live');
    assert.equal(h.engine.status('withdrawals'), 'live');
    const cards = h.transport.latest('admin:cards');
    cards.onMessage(change('card_submissions', CARD_ID, 'approved'));
    cards.onMessage(change('withdrawals', WITHDRAWAL_ID, 'held'));
    cards.onMessage(change('card_submissions', 'x', 'approved'));
    h.transport.latest('admin:withdrawals').onMessage(
      change('flagged_transactions', FLAG_ID, 'pending_review', { withdrawal_id: WITHDRAWAL_ID }),
    );
    const approved = { kind: 'signal', table: 'card_submissions', id: CARD_ID, status: 'approved' };
    assert.deepEqual(first, [{ kind: 'resync' }, approved]);
    assert.deepEqual(second, [{ kind: 'resync' }, approved]);
    assert.deepEqual(flags, [
      { kind: 'resync' },
      { kind: 'signal', table: 'flagged_transactions', id: FLAG_ID, status: 'pending_review', withdrawalId: WITHDRAWAL_ID },
    ]);
    assert.equal(h.transport.joins.length, 2);
  });

  test('a consumer that throws does not stop the others or the engine', async () => {
    const h = setup();
    const seen: RealtimeSignal[] = [];
    h.engine.subscribe('cards', () => {
      throw new Error('consumer bug');
    });
    h.engine.subscribe('cards', (signal) => {
      seen.push(signal);
    });
    await settle();
    await h.answer(granted().result);
    h.transport.latest('admin:cards').onStatus('SUBSCRIBED', null);
    h.transport.latest('admin:cards').onMessage(change('card_submissions', CARD_ID, 'rejected'));
    await settle();
    assert.deepEqual(seen, [{ kind: 'resync' }, { kind: 'signal', table: 'card_submissions', id: CARD_ID, status: 'rejected' }]);
    assert.equal(h.engine.status('cards'), 'live');
  });

  test('TIMED_OUT, CHANNEL_ERROR and CLOSED fall back at once, leave before the backoff timer, and retry on the 2, 5, 10, 30, 60, 60 s ladder', async () => {
    const h = setup();
    const seen = await goLive(h, ['cards']);
    const failures: Array<[ChannelStatus, string | null]> = [
      ['TIMED_OUT', null], ['CHANNEL_ERROR', null], ['CLOSED', null], ['TIMED_OUT', null], ['CLOSED', null], ['CHANNEL_ERROR', null],
    ];
    const ladder = [2000, 5000, 10000, 30000, 60000, 60000];
    for (const [index, [status, reason]] of failures.entries()) {
      const start = h.log.length;
      h.transport.latest('admin:cards').onStatus(status, reason);
      assert.equal(h.engine.status('cards'), 'fallback', status);
      await settle();
      const after = h.log.slice(start);
      const left = after.indexOf('leave admin:cards');
      const armed = after.findIndex((entry) => entry.startsWith('timer '));
      assert.ok(left >= 0 && (armed === -1 || left < armed), after.join(', '));
      assert.ok(armed === -1 || after[armed] === `timer ${ladder[index]}`, after.join(', '));
      assert.ok(after.indexOf('disconnect') > left, after.join(', '));
      const joins = h.transport.joinsOf('admin:cards').length;
      await h.clock.advance(ladder[index] - 1);
      assert.equal(h.transport.joinsOf('admin:cards').length, joins, `no join before ${ladder[index]} ms`);
      await h.clock.advance(1);
      assert.equal(h.transport.joinsOf('admin:cards').length, joins + 1, `a join at ${ladder[index]} ms`);
      assert.equal(h.engine.status('cards'), 'fallback');
    }
    assert.equal(h.requests(), 1);
    h.transport.latest('admin:cards').onStatus('SUBSCRIBED', null);
    await settle();
    assert.equal(h.engine.status('cards'), 'live');
    assert.deepEqual(seen.cards, [{ kind: 'resync' }, { kind: 'resync' }]);
  });

  test('a join refused for read permission is final for that topic: no backoff, no further join, while the other topic carries on', async () => {
    const h = setup();
    h.engine.subscribe('withdrawals', () => {});
    h.engine.subscribe('cards', () => {});
    await settle();
    await h.answer(granted().result);
    h.transport.latest('admin:withdrawals').onStatus('SUBSCRIBED', null);
    const start = h.log.length;
    h.transport.latest('admin:cards').onStatus('CHANNEL_ERROR', DENIED);
    await settle();
    assert.equal(h.engine.status('cards'), 'fallback');
    assert.equal(h.engine.status('withdrawals'), 'live');
    assert.deepEqual(since(h.log, start), ['leave admin:cards']);
    assert.ok(!h.log.slice(start).some((entry) => /^timer (?:2000|5000)$/.test(entry)));
    await h.clock.advance(200_000);
    assert.equal(h.transport.joinsOf('admin:cards').length, 1);
    assert.equal(h.engine.status('cards'), 'fallback');
  });

  test('a final refusal is tried again only after a renewal returns a different topic list', async () => {
    const h = setup();
    h.engine.subscribe('withdrawals', () => {});
    h.engine.subscribe('cards', () => {});
    await settle();
    await h.answer(granted().result);
    h.transport.latest('admin:withdrawals').onStatus('SUBSCRIBED', null);
    h.transport.latest('admin:cards').onStatus('CHANNEL_ERROR', DENIED);
    await settle();
    await h.clock.advance(240_000);
    await h.answer(granted().result);
    assert.equal(h.transport.joinsOf('admin:cards').length, 1);
    await h.clock.advance(240_000);
    await h.answer(granted({ topics: ['admin:withdrawals'] }).result);
    assert.equal(h.transport.joinsOf('admin:cards').length, 1);
    assert.equal(h.engine.status('cards'), 'fallback');
    await h.clock.advance(240_000);
    await h.answer(granted().result);
    assert.equal(h.transport.joinsOf('admin:cards').length, 2);
    h.transport.latest('admin:cards').onStatus('SUBSCRIBED', null);
    await settle();
    assert.equal(h.engine.status('cards'), 'live');
  });

  test('three refused joins in a row with no SUBSCRIBED between them are final; a SUBSCRIBED in between starts the count again', async () => {
    const h = setup();
    h.engine.subscribe('cards', () => {});
    await settle();
    await h.answer(granted().result);
    const refuse = async (wait: number | null) => {
      h.transport.latest('admin:cards').onStatus('CHANNEL_ERROR', SIGNATURE_REFUSAL);
      await settle();
      if (wait !== null) await h.clock.advance(wait);
    };
    await refuse(2000);
    await refuse(5000);
    h.transport.latest('admin:cards').onStatus('SUBSCRIBED', null);
    await settle();
    assert.equal(h.engine.status('cards'), 'live');
    await refuse(10000);
    await refuse(30000);
    assert.equal(h.transport.joinsOf('admin:cards').length, 5);
    const start = h.log.length;
    await refuse(null);
    assert.deepEqual(since(h.log, start), ['leave admin:cards', 'disconnect']);
    await h.clock.advance(HOUR_MS);
    assert.equal(h.transport.joinsOf('admin:cards').length, 5);
    assert.equal(h.engine.status('cards'), 'fallback');
    assert.equal(h.clock.timers(), 0);
  });

  test('a channel that drops straight after SUBSCRIBED keeps climbing the ladder, so a flapping link cannot resync every 2 s', async () => {
    const h = setup();
    const seen = await goLive(h, ['cards'], granted({ lifetime: 3600 }));
    const ladder = [2000, 5000, 10000, 30000, 60000, 60000];
    for (const wait of ladder) {
      h.transport.latest('admin:cards').onStatus('CLOSED', null);
      await settle();
      const joins = h.transport.joinsOf('admin:cards').length;
      await h.clock.advance(wait - 1);
      assert.equal(h.transport.joinsOf('admin:cards').length, joins, `no join before ${wait} ms`);
      await h.clock.advance(1);
      assert.equal(h.transport.joinsOf('admin:cards').length, joins + 1, `a join at ${wait} ms`);
      h.transport.latest('admin:cards').onStatus('SUBSCRIBED', null);
      await settle();
    }
    assert.equal(seen.cards.length, ladder.length + 1);
  });

  test('a channel that stayed SUBSCRIBED for a minute starts the ladder again at 2 s when it drops', async () => {
    const h = setup();
    await goLive(h, ['cards'], granted({ lifetime: 3600 }));
    for (const wait of [2000, 5000, 10000]) {
      h.transport.latest('admin:cards').onStatus('CLOSED', null);
      await settle();
      await h.clock.advance(wait);
      h.transport.latest('admin:cards').onStatus('SUBSCRIBED', null);
      await settle();
    }
    await h.clock.advance(core.STABLE_JOIN_MS);
    h.transport.latest('admin:cards').onStatus('CHANNEL_ERROR', null);
    await settle();
    const joins = h.transport.joinsOf('admin:cards').length;
    await h.clock.advance(1999);
    assert.equal(h.transport.joinsOf('admin:cards').length, joins);
    await h.clock.advance(1);
    assert.equal(h.transport.joinsOf('admin:cards').length, joins + 1);
  });

  test('a dropped socket, a CHANNEL_ERROR with no reason, is never final: it keeps retrying, at most once a minute', async () => {
    const h = setup();
    await goLive(h, ['cards'], granted({ lifetime: 3600 }));
    const ladder = [2000, 5000, 10000, 30000, 60000, 60000, 60000, 60000];
    for (const wait of ladder) {
      h.transport.latest('admin:cards').onStatus('CHANNEL_ERROR', null);
      await settle();
      const joins = h.transport.joinsOf('admin:cards').length;
      await h.clock.advance(wait);
      assert.equal(h.transport.joinsOf('admin:cards').length, joins + 1, `a join after ${wait} ms`);
    }
    h.transport.latest('admin:cards').onStatus('SUBSCRIBED', null);
    await settle();
    assert.equal(h.engine.status('cards'), 'live');
  });

  test('ship-before-SQL: when every join is refused for read permission, each topic is tried once and pages keep polling, with no loop', async () => {
    const h = setup();
    h.engine.subscribe('withdrawals', () => {});
    h.engine.subscribe('cards', () => {});
    await settle();
    await h.answer(granted().result);
    h.transport.latest('admin:withdrawals').onStatus('CHANNEL_ERROR', DENIED.replace('admin:cards', 'admin:withdrawals'));
    h.transport.latest('admin:cards').onStatus('CHANNEL_ERROR', DENIED);
    await settle();
    assert.deepEqual(since(h.log, 0).slice(-3), ['leave admin:withdrawals', 'leave admin:cards', 'disconnect']);
    await h.clock.advance(HOUR_MS);
    assert.equal(h.transport.joins.length, 2);
    assert.equal(h.requests(), 1);
    assert.equal(h.clock.timers(), 0);
    assert.equal(h.engine.status('withdrawals'), 'fallback');
    assert.equal(h.engine.status('cards'), 'fallback');
  });

  test('the pass is renewed at 80 per cent of its lifetime and handed to the open channel with setAuth', async () => {
    const h = setup();
    await goLive(h, ['cards']);
    await h.clock.advance(239_999);
    assert.equal(h.requests(), 1);
    await h.clock.advance(1);
    assert.equal(h.requests(), 2);
    const start = h.log.length;
    const next = granted();
    await h.answer(next.result);
    assert.deepEqual(since(h.log, start), [`setAuth ${next.token}`]);
    assert.equal(h.engine.status('cards'), 'live');
    await h.clock.advance(240_000);
    assert.equal(h.requests(), 3);
    const short = granted({ lifetime: 100 });
    await h.answer(short.result);
    await h.clock.advance(79_999);
    assert.equal(h.requests(), 3);
    await h.clock.advance(1);
    assert.equal(h.requests(), 4);
  });

  test('no renewal while hidden; on return the pass is renewed, the channel the server closed is joined again, and consumers resync', async () => {
    const h = setup();
    const seen = await goLive(h, ['cards']);
    await h.clock.advance(100_000);
    h.clock.setHidden(true);
    await h.clock.advance(200_000);
    assert.equal(h.requests(), 1);
    const start = h.log.length;
    h.transport.latest('admin:cards').onStatus('CLOSED', null);
    await settle();
    assert.deepEqual(h.log.slice(start), ['leave admin:cards', 'disconnect']);
    assert.equal(h.engine.status('cards'), 'fallback');
    await h.clock.advance(100_000);
    assert.equal(h.requests(), 1);
    assert.equal(h.transport.joinsOf('admin:cards').length, 1);
    h.clock.setHidden(false);
    await settle();
    assert.equal(h.requests(), 2);
    const next = granted();
    await h.answer(next.result);
    assert.deepEqual(since(h.log, start).slice(-2), [`connect ${next.token}`, 'join admin:cards']);
    h.transport.latest('admin:cards').onStatus('SUBSCRIBED', null);
    await settle();
    assert.equal(h.engine.status('cards'), 'live');
    assert.deepEqual(seen.cards, [{ kind: 'resync' }, { kind: 'resync' }]);
  });

  test('a short trip away with the channel still open sends a resync on return and asks for nothing', async () => {
    const h = setup();
    const seen = await goLive(h, ['cards']);
    h.clock.setHidden(true);
    await h.clock.advance(10_000);
    h.clock.setHidden(false);
    assert.deepEqual(seen.cards, [{ kind: 'resync' }, { kind: 'resync' }]);
    await settle();
    assert.equal(h.requests(), 1);
    assert.equal(h.transport.joins.length, 1);
    assert.equal(h.engine.status('cards'), 'live');
  });

  for (const status of [401, 403]) {
    test(`a ${status} on renewal leaves every channel, closes the socket and stops for the page load`, async () => {
      const h = setup();
      await goLive(h, ['withdrawals', 'cards']);
      await h.clock.advance(240_000);
      const start = h.log.length;
      await h.answer(failure(status));
      assert.deepEqual(since(h.log, start), ['leave admin:withdrawals', 'leave admin:cards', 'disconnect']);
      assert.equal(h.engine.status('withdrawals'), 'fallback');
      assert.equal(h.engine.status('cards'), 'fallback');
      await h.clock.advance(HOUR_MS);
      assert.equal(h.requests(), 2);
      assert.equal(h.transport.joins.length, 2);
      assert.equal(h.clock.timers(), 0);
      h.engine.subscribe('cards', () => {});
      await settle();
      assert.equal(h.requests(), 2);
      assert.equal(h.engine.status('cards'), 'fallback');
    });
  }

  test('a 401 or 403 on the first pass never loads the transport', async () => {
    for (const status of [401, 403]) {
      const h = setup();
      h.engine.subscribe('cards', () => {});
      await settle();
      await h.answer(failure(status));
      assert.equal(h.loads(), 0);
      assert.equal(h.engine.status('cards'), 'fallback');
      assert.equal(h.clock.timers(), 0);
    }
  });

  test('enabled:false never loads the transport, and every consumer stays on polling for the page load', async () => {
    const h = setup();
    h.engine.subscribe('cards', () => {});
    await settle();
    await h.answer(switchedOff());
    assert.equal(h.loads(), 0);
    assert.equal(h.engine.status('cards'), 'fallback');
    h.engine.subscribe('withdrawals', () => {});
    await h.clock.advance(HOUR_MS);
    assert.equal(h.engine.status('withdrawals'), 'fallback');
    assert.equal(h.requests(), 1);
    assert.equal(h.loads(), 0);
    assert.equal(h.transport.joins.length, 0);
    assert.equal(h.clock.timers(), 0);
  });

  test('an unreachable pass route leaves pages polling and is retried on the 5, 10, 30, 60, 60 s ladder', async () => {
    const h = setup();
    h.engine.subscribe('cards', () => {});
    await settle();
    await h.answer(failure(500));
    assert.equal(h.engine.status('cards'), 'fallback');
    const answers = [failure(null, 'network'), failure(429), failure(null, 'timeout'), failure(503)];
    const ladder = [5000, 10000, 30000, 60000, 60000];
    for (const [index, wait] of ladder.entries()) {
      const before = h.requests();
      await h.clock.advance(wait - 1);
      assert.equal(h.requests(), before, `no request before ${wait} ms`);
      await h.clock.advance(1);
      assert.equal(h.requests(), before + 1, `a request at ${wait} ms`);
      if (index < answers.length) await h.answer(answers[index]);
    }
    assert.equal(h.loads(), 0);
    await h.answer(granted().result);
    assert.equal(h.transport.joins.length, 1);
    h.transport.latest('admin:cards').onStatus('SUBSCRIBED', null);
    await settle();
    assert.equal(h.engine.status('cards'), 'live');
  });

  test('an outage on renewal keeps the current pass and channel, signs no one out, and retries on the pass ladder', async () => {
    const h = setup();
    await goLive(h, ['cards']);
    await h.clock.advance(240_000);
    const start = h.log.length;
    await h.answer(failure(502));
    assert.equal(h.engine.status('cards'), 'live');
    await h.clock.advance(5000);
    assert.equal(h.requests(), 3);
    await h.answer(failure(null, 'network'));
    await h.clock.advance(10_000);
    assert.equal(h.requests(), 4);
    const next = granted();
    await h.answer(next.result);
    assert.deepEqual(since(h.log, start), ['pass', 'pass', `setAuth ${next.token}`]);
    assert.equal(h.engine.status('cards'), 'live');
  });

  test('when renewal keeps failing past expiry, the closed channel waits for a fresh pass instead of joining with a stale one', async () => {
    const h = setup();
    await goLive(h, ['cards']);
    await h.clock.advance(240_000);
    await h.answer(failure(500));
    await h.clock.advance(5000);
    await h.answer(failure(500));
    await h.clock.advance(55_000);
    h.transport.latest('admin:cards').onStatus('CLOSED', null);
    await settle();
    await h.clock.advance(5000);
    assert.equal(h.transport.joinsOf('admin:cards').length, 1);
    assert.equal(h.engine.status('cards'), 'fallback');
    await h.answer(granted().result);
    assert.equal(h.transport.joinsOf('admin:cards').length, 2);
  });

  test('a renewal that loses a topic leaves that channel before the new pass is set, and the other topic stays live', async () => {
    const h = setup();
    await goLive(h, ['withdrawals', 'cards']);
    await h.clock.advance(240_000);
    const start = h.log.length;
    const next = granted({ topics: ['admin:withdrawals'] });
    await h.answer(next.result);
    assert.deepEqual(since(h.log, start), ['leave admin:cards', `setAuth ${next.token}`]);
    assert.equal(h.engine.status('cards'), 'fallback');
    assert.equal(h.engine.status('withdrawals'), 'live');
  });

  test('a renewal that points at another project leaves, closes the socket and reconnects there with the new pass', async () => {
    const h = setup();
    await goLive(h, ['cards']);
    await h.clock.advance(240_000);
    const start = h.log.length;
    const next = granted({ url: 'https://other.supabase.test' });
    await h.answer(next.result);
    assert.deepEqual(since(h.log, start), ['leave admin:cards', 'disconnect', `connect ${next.token}`, 'join admin:cards']);
  });

  test('the last consumer leaving keeps the channel 5 s for StrictMode and page changes, then leaves and closes the socket', async () => {
    const h = setup();
    const pass = granted();
    const stop = h.engine.subscribe('cards', () => {});
    await settle();
    await h.answer(pass.result);
    h.transport.latest('admin:cards').onStatus('SUBSCRIBED', null);
    await settle();
    stop();
    stop();
    assert.equal(h.engine.status('cards'), 'off');
    await h.clock.advance(4999);
    assert.ok(!h.log.includes('leave admin:cards'));
    const again = h.engine.subscribe('cards', () => {});
    await settle();
    assert.equal(h.engine.status('cards'), 'live');
    await h.clock.advance(10_000);
    assert.ok(!h.log.includes('leave admin:cards'));
    const start = h.log.length;
    again();
    await h.clock.advance(5000);
    assert.deepEqual(since(h.log, start), ['leave admin:cards', 'disconnect']);
    h.engine.subscribe('cards', () => {});
    await settle();
    assert.deepEqual(since(h.log, start).slice(2), [`connect ${pass.token}`, 'join admin:cards']);
    assert.equal(h.requests(), 1);
  });

  test('StrictMode mount, unmount and mount in one tick join once and never leave', async () => {
    const h = setup();
    const stop = h.engine.subscribe('cards', () => {});
    stop();
    h.engine.subscribe('cards', () => {});
    await settle();
    await h.answer(granted().result);
    await h.clock.advance(20_000);
    assert.equal(h.transport.joins.length, 1);
    assert.ok(!h.log.includes('leave admin:cards'));
  });

  test('a join that never answers is abandoned after 30 s as a timeout and retried on the ladder', async () => {
    const h = setup();
    h.engine.subscribe('cards', () => {});
    await settle();
    await h.answer(granted().result);
    await h.clock.advance(29_999);
    assert.ok(!h.log.includes('leave admin:cards'));
    assert.equal(h.engine.status('cards'), 'connecting');
    await h.clock.advance(1);
    assert.ok(h.log.includes('leave admin:cards'));
    assert.equal(h.engine.status('cards'), 'fallback');
    await h.clock.advance(2000);
    assert.equal(h.transport.joinsOf('admin:cards').length, 2);
  });

  test('a connect that throws is retried on the channel ladder', async () => {
    const h = setup();
    h.transport.failConnect = true;
    h.engine.subscribe('cards', () => {});
    await settle();
    await h.answer(granted().result);
    assert.equal(h.transport.joins.length, 0);
    assert.equal(h.engine.status('cards'), 'fallback');
    h.transport.failConnect = false;
    await h.clock.advance(2000);
    assert.equal(h.transport.joins.length, 1);
  });

  test('a transport that cannot be loaded turns realtime off for the page load, with no retry', async () => {
    const h = setup({ loadFails: true });
    h.engine.subscribe('cards', () => {});
    await settle();
    await h.answer(granted().result);
    await h.clock.advance(HOUR_MS);
    assert.equal(h.loads(), 1);
    assert.equal(h.requests(), 1);
    assert.equal(h.engine.status('cards'), 'fallback');
    assert.equal(h.clock.timers(), 0);
  });

  test('status changes are announced to watchers, and dispose leaves every channel, closes the socket and ignores late answers', async () => {
    const h = setup();
    let notices = 0;
    h.engine.watch(() => {
      notices += 1;
    });
    await goLive(h, ['withdrawals', 'cards']);
    assert.ok(notices >= 2);
    const start = h.log.length;
    h.engine.dispose();
    await settle();
    assert.deepEqual(since(h.log, start), ['leave admin:withdrawals', 'leave admin:cards', 'disconnect']);
    assert.equal(h.engine.status('cards'), 'off');
    const after = h.engine.subscribe('cards', () => {});
    after();
    assert.equal(h.engine.status('cards'), 'off');
    assert.equal(h.clock.timers(), 0);

    const pending = setup();
    pending.engine.subscribe('cards', () => {});
    await settle();
    pending.engine.dispose();
    await pending.answer(granted().result);
    assert.equal(pending.loads(), 0);
    assert.equal(pending.transport.joins.length, 0);
  });
});

describe('the Supabase transport against a fake Realtime socket', () => {
  let originalSocket: unknown;

  before(() => {
    originalSocket = Reflect.get(globalThis, 'WebSocket');
  });

  beforeEach(() => {
    FakeSocket.sockets = [];
    FakeSocket.joinReply = () => ({ status: 'ok', response: {} });
    Reflect.set(globalThis, 'WebSocket', FakeSocket);
    mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  });

  afterEach(() => {
    mock.timers.reset();
    Reflect.set(globalThis, 'WebSocket', originalSocket);
  });

  test('connect holds the pass before it resolves, so the first join already carries it, on a private channel', async () => {
    const transport = transports.createSupabaseTransport();
    await transport.connect(SUPABASE_URL, PUBLISHABLE_KEY, 'eyJ0.first.pass');
    const seen = recorder();
    transport.join('admin:cards', seen.onMessage, seen.onStatus);
    await settle();
    assert.equal(FakeSocket.sockets.length, 1);
    const [socket] = FakeSocket.sockets;
    assert.ok(socket.url.startsWith('wss://project.supabase.test/realtime/v1/websocket?'), socket.url);
    assert.equal(new URL(socket.url).searchParams.get('apikey'), PUBLISHABLE_KEY);
    assert.ok(!socket.url.includes('first.pass'));
    const joins = framesOf('phx_join');
    assert.equal(joins.length, 1);
    assert.equal(joins[0].topic, 'realtime:admin:cards');
    assert.equal(joins[0].payload.access_token, 'eyJ0.first.pass');
    const config = joins[0].payload.config as Record<string, unknown>;
    assert.equal(config.private, true);
    assert.deepEqual(config.broadcast, { self: false, ack: false });
    assert.deepEqual(seen.statuses, [['SUBSCRIBED', null]]);
    await transport.disconnect();
  });

  test('changed broadcasts reach the engine, a new pass goes to the open channel, and leave closes it without echoing CLOSED', async () => {
    const transport = transports.createSupabaseTransport();
    await transport.connect(SUPABASE_URL, PUBLISHABLE_KEY, 'eyJ0.first.pass');
    const seen = recorder();
    transport.join('admin:cards', seen.onMessage, seen.onStatus);
    await settle();
    const [socket] = FakeSocket.sockets;
    const [join] = framesOf('phx_join');
    const payload = change('card_submissions', CARD_ID, 'approved');
    socket.deliver([join.joinRef, null, 'realtime:admin:cards', 'broadcast', { type: 'broadcast', event: 'changed', payload }]);
    socket.deliver([join.joinRef, null, 'realtime:admin:cards', 'broadcast', { type: 'broadcast', event: 'other', payload }]);
    assert.deepEqual(seen.payloads, [payload]);
    await transport.setAuth('eyJ0.second.pass');
    assert.deepEqual(framesOf('access_token').map((frame) => frame.payload.access_token), ['eyJ0.second.pass']);
    await transport.leave('admin:cards');
    await settle();
    assert.equal(framesOf('phx_leave').length, 1);
    assert.deepEqual(seen.statuses, [['SUBSCRIBED', null]]);
    assert.equal(socket.readyState, 3);
    socket.readyState = 1;
    socket.deliver([join.joinRef, null, 'realtime:admin:cards', 'broadcast', { type: 'broadcast', event: 'changed', payload }]);
    assert.equal(seen.payloads.length, 1);
    await transport.disconnect();
  });

  test('a refused join is reported once with its reason and removed at once, so realtime-js never retries it on its own', async () => {
    FakeSocket.joinReply = () => ({ status: 'error', response: { reason: DENIED } });
    const transport = transports.createSupabaseTransport();
    await transport.connect(SUPABASE_URL, PUBLISHABLE_KEY, 'eyJ0.first.pass');
    const seen = recorder();
    transport.join('admin:cards', seen.onMessage, seen.onStatus);
    await settle();
    assert.equal(seen.statuses.length, 1);
    assert.equal(seen.statuses[0][0], 'CHANNEL_ERROR');
    assert.match(seen.statuses[0][1] ?? '', /You do not have permissions to read from this Channel topic/);
    await tickFor(120_000);
    assert.equal(framesOf('phx_join').length, 1);
    assert.equal(FakeSocket.sockets.length, 1);
    assert.equal(seen.statuses.length, 1);
    await transport.leave('admin:cards');
    await transport.disconnect();
  });

  test('a join with no answer times out after 10 s, is reported once, and is never retried by realtime-js', async () => {
    FakeSocket.joinReply = () => null;
    const transport = transports.createSupabaseTransport();
    await transport.connect(SUPABASE_URL, PUBLISHABLE_KEY, 'eyJ0.first.pass');
    const seen = recorder();
    transport.join('admin:cards', seen.onMessage, seen.onStatus);
    await settle();
    assert.deepEqual(seen.statuses, []);
    mock.timers.tick(10_000);
    await settle();
    assert.deepEqual(seen.statuses, [['TIMED_OUT', null]]);
    await tickFor(120_000);
    assert.equal(framesOf('phx_join').length, 1);
    assert.equal(seen.statuses.length, 1);
    await transport.leave('admin:cards');
    await transport.disconnect();
  });

  test('a dropped socket is one CHANNEL_ERROR with no reason, and the client neither reconnects nor rejoins on its own', async () => {
    const transport = transports.createSupabaseTransport();
    await transport.connect(SUPABASE_URL, PUBLISHABLE_KEY, 'eyJ0.first.pass');
    const seen = recorder();
    transport.join('admin:cards', seen.onMessage, seen.onStatus);
    await settle();
    FakeSocket.sockets[0].drop();
    await settle();
    assert.deepEqual(seen.statuses, [['SUBSCRIBED', null], ['CHANNEL_ERROR', null]]);
    await tickFor(120_000);
    assert.equal(FakeSocket.sockets.length, 1);
    assert.equal(framesOf('phx_join').length, 1);
    await transport.leave('admin:cards');
    await transport.disconnect();
  });

  test('disconnect closes the socket, and the next connect opens a fresh one whose first join carries the new pass', async () => {
    const transport = transports.createSupabaseTransport();
    await transport.connect(SUPABASE_URL, PUBLISHABLE_KEY, 'eyJ0.first.pass');
    const first = recorder();
    transport.join('admin:cards', first.onMessage, first.onStatus);
    await settle();
    await transport.disconnect();
    await settle();
    assert.equal(FakeSocket.sockets[0].readyState, 3);
    assert.deepEqual(first.statuses, [['SUBSCRIBED', null]]);
    await transport.connect(SUPABASE_URL, PUBLISHABLE_KEY, 'eyJ0.second.pass');
    const second = recorder();
    transport.join('admin:cards', second.onMessage, second.onStatus);
    await settle();
    assert.equal(FakeSocket.sockets.length, 2);
    const joins = FakeSocket.sockets[1].frames.filter((frame) => frame.event === 'phx_join');
    assert.equal(joins.length, 1);
    assert.equal(joins[0].payload.access_token, 'eyJ0.second.pass');
    assert.deepEqual(second.statuses, [['SUBSCRIBED', null]]);
    await transport.disconnect();
  });

  test('end to end: the pass rides the first join, a changed broadcast reaches the consumer, and renewal pushes the new pass', async () => {
    const log: string[] = [];
    const clock = createClock(log);
    const passes = [granted(), granted()];
    let requests = 0;
    const engine = new core.SignalsEngine({
      environment: clock.env,
      fetchPass: async () => {
        const next = passes[requests];
        requests += 1;
        return next.result;
      },
      loadTransport: async () => transports.createSupabaseTransport(),
    });
    const seen: RealtimeSignal[] = [];
    engine.subscribe('cards', (signal) => {
      seen.push(signal);
    });
    await settle(10);
    const [join] = framesOf('phx_join');
    assert.equal(join.payload.access_token, passes[0].token);
    assert.equal((join.payload.config as Record<string, unknown>).private, true);
    assert.equal(engine.status('cards'), 'live');
    assert.deepEqual(seen, [{ kind: 'resync' }]);
    FakeSocket.sockets[0].deliver([join.joinRef, null, 'realtime:admin:cards', 'broadcast', {
      type: 'broadcast', event: 'changed', payload: change('card_submissions', CARD_ID, 'approved'),
    }]);
    assert.deepEqual(seen.at(-1), { kind: 'signal', table: 'card_submissions', id: CARD_ID, status: 'approved' });
    await clock.advance(240_000);
    await settle(10);
    assert.equal(requests, 2);
    assert.deepEqual(framesOf('access_token').map((frame) => frame.payload.access_token), [passes[1].token]);
    assert.equal(framesOf('phx_join').length, 1);
    engine.dispose();
    await settle(10);
    assert.equal(FakeSocket.sockets[0].readyState, 3);
  });

  test('end to end, ship-before-SQL: every join refused for read permission means one join per topic, then polling with no loop', async () => {
    FakeSocket.joinReply = (frame) => ({
      status: 'error',
      response: { reason: `Unauthorized: You do not have permissions to read from this Channel topic: ${frame.topic.slice('realtime:'.length)}` },
    });
    const log: string[] = [];
    const clock = createClock(log);
    let requests = 0;
    const engine = new core.SignalsEngine({
      environment: clock.env,
      fetchPass: async () => {
        requests += 1;
        return granted().result;
      },
      loadTransport: async () => transports.createSupabaseTransport(),
    });
    engine.subscribe('withdrawals', () => {});
    engine.subscribe('cards', () => {});
    await settle(10);
    assert.equal(framesOf('phx_join').length, 2);
    assert.equal(engine.status('withdrawals'), 'fallback');
    assert.equal(engine.status('cards'), 'fallback');
    for (let minute = 0; minute < 30; minute += 1) {
      await clock.advance(60_000);
      await tickFor(60_000);
    }
    assert.equal(framesOf('phx_join').length, 2);
    assert.equal(FakeSocket.sockets.length, 1);
    assert.equal(requests, 1);
    assert.equal(clock.timers(), 0);
    engine.dispose();
  });
});

describe('the provider and the hook', () => {
  function Probe({ topic }: { topic: SignalTopic | null }) {
    const { live } = signals.useRealtimeSignal(topic, () => {});
    return createElement('output', { id: `probe-${topic ?? 'none'}` }, live ? 'live' : 'polling');
  }

  test('the provider renders its children, and every consumer starts on polling', () => {
    const html = render(createElement(signals.RealtimeSignalsProvider, {
      children: [createElement(Probe, { key: 'cards', topic: 'cards' }), createElement(Probe, { key: 'none', topic: null })],
    }));
    assert.equal(html, '<output id="probe-cards">polling</output><output id="probe-none">polling</output>');
  });

  test('outside the provider the hook reports polling and never subscribes', () => {
    assert.equal(render(createElement(Probe, { topic: 'withdrawals' })), '<output id="probe-withdrawals">polling</output>');
  });

  test('the provider builds one engine per tab in an effect, asks the pass route by POST, and loads the transport only by dynamic import', () => {
    const source = read(PROVIDER_FILE);
    assert.ok(source.startsWith("'use client';\n"));
    assert.equal(signals.REALTIME_PASS_PATH, '/api/realtime/pass');
    assert.match(source, /fetchPass: \(\) => apiRequest\(REALTIME_PASS_PATH, \{ method: 'POST', timeoutMs: API_READ_TIMEOUT_MS \}\)/);
    assert.match(source, /loadTransport: async \(\) => \(await import\('\.\/supabaseTransport'\)\)\.createSupabaseTransport\(\)/);
    assert.match(source, /useEffect\(\(\) => \{\s*const next = createEngine\(\);\s*setEngine\(next\);\s*return \(\) => next\.dispose\(\);\s*\}, \[\]\);/);
    assert.deepEqual(staticImports(source), ['react', '../../lib/apiClient', './signalsCore']);
    assert.equal(source.match(/supabaseTransport/g)?.length, 1);
  });

  test('the hook keeps the latest callback in a ref, subscribes once per engine and topic, and is live only while the topic is', () => {
    const source = read(PROVIDER_FILE);
    assert.match(source, /useEffect\(\(\) => \{\s*handler\.current = onSignal;\s*\}\);/);
    assert.match(
      source,
      /useEffect\(\(\) => \{\s*if \(!engine \|\| !topic\) return;\s*return engine\.subscribe\(topic, \(signal\) => handler\.current\(signal\)\);\s*\}, \[engine, topic\]\);/,
    );
    assert.match(source, /const status = useSyncExternalStore\(watch, read, readOff\);/);
    assert.match(source, /const live = status === 'live';\s*return useMemo\(\(\) => \(\{ live \}\), \[live\]\);/);
  });

  test('the shell still renders its page inside the provider', async () => {
    const shell = await loadAppModule<ShellModule>('(dashboard)/_shell/Shell.tsx');
    const theme = await loadUi<ThemeModule>('theme.tsx');
    const { PathnameContext } = nodeRequire('next/dist/shared/lib/hooks-client-context.shared-runtime') as {
      PathnameContext: Context<string | null>;
    };
    const props: ShellProps = {
      allowedKeys: ['withdrawals', 'card_queue'],
      isSuperAdmin: false,
      permissions: ['cards.read', 'withdrawals.read'],
      username: 'ada',
      roleTitle: 'Card Reviewer',
      children: createElement('p', { id: 'page-probe' }, 'page body'),
    };
    const html = render(createElement(
      PathnameContext.Provider,
      { value: '/withdrawals' },
      createElement(theme.ThemeProvider, {
        initialMode: 'light',
        initialResolved: 'light',
        children: createElement(shell.Shell, props),
      }),
    ));
    assert.match(html, /<main[^>]*id="main-content"[^>]*>[\s\S]*<p id="page-probe">page body<\/p>[\s\S]*<\/main>/);
  });
});

describe('house rules for realtime signals', () => {
  test('the new files carry no prose comments', () => {
    for (const file of [CORE_FILE, TRANSPORT_FILE, PROVIDER_FILE, TEST_FILE]) {
      assert.doesNotMatch(read(file), /\/\*|(^|[^:])\/\/(?!\/)/m, rel(file));
    }
  });

  test('the engine knows nothing of React or Supabase, and keeps the pass in memory only', () => {
    const source = read(CORE_FILE);
    assert.doesNotMatch(source, /^\s*['"]use client['"]/);
    assert.deepEqual(staticImports(source), ['../../lib/http']);
    assert.doesNotMatch(source, /react|@supabase|localStorage|sessionStorage|indexedDB|console\.|process\.env|NEXT_PUBLIC/);
  });

  test('the tab-return resync is heard on window in the capture phase, ahead of the pages\' own visibility handlers', () => {
    const source = read(CORE_FILE);
    assert.match(source, /window\.addEventListener\('visibilitychange', callback, true\);/);
    assert.match(source, /window\.removeEventListener\('visibilitychange', callback, true\)/);
    assert.doesNotMatch(source, /document\.addEventListener/);
    assert.match(read(join(UI_DIR, 'useResource.ts')), /document\.addEventListener\('visibilitychange', onVisibility\);/);
  });

  test('only the transport imports supabase-js on the client, with private broadcast channels, no worker and no logging', () => {
    const source = read(TRANSPORT_FILE);
    assert.deepEqual(staticImports(source), ['@supabase/supabase-js', './signalsCore']);
    assert.doesNotMatch(source, /worker|logger|console\.|localStorage|sessionStorage|process\.env|NEXT_PUBLIC/i);
    const channels = [...source.matchAll(/\.channel\(([^)]*)\)/g)].map((match) => match[1]);
    assert.deepEqual(channels, ['topic, { config: { private: true, broadcast: { self: false, ack: false } } }']);
    assert.match(source, /\.on\('broadcast', \{ event: SIGNAL_EVENT \}/);
    assert.equal(core.SIGNAL_EVENT, 'changed');
    const importers = walk(APP_DIR).filter((file) => /from ['"]@supabase\/supabase-js['"]/.test(read(file))).map(rel).sort();
    assert.deepEqual(importers, [rel(TRANSPORT_FILE), rel(SUPABASE_LIB_FILE)].sort());
  });

  test('nothing in the console listens to table changes, sends whole rows, or opens a channel outside the transport', () => {
    const files = walk(APP_DIR);
    assert.ok(files.length > 100, String(files.length));
    for (const file of files) {
      const source = read(file);
      assert.ok(!source.includes('postgres_changes') && !source.includes('broadcast_changes'), rel(file));
      if (file !== TRANSPORT_FILE) assert.doesNotMatch(source, /\.channel\(/, rel(file));
      if (file !== PASS_LIB_FILE) assert.ok(!source.includes('SUPABASE_REALTIME_JWT_SECRET'), rel(file));
    }
  });

  test('the realtime modules never reach the server pass library or the service client', () => {
    for (const file of [CORE_FILE, TRANSPORT_FILE, PROVIDER_FILE]) {
      const graph = staticGraph(file);
      assert.ok(!graph.files.has(PASS_LIB_FILE) && !graph.files.has(SUPABASE_LIB_FILE) && !graph.files.has(PASS_ROUTE_FILE), rel(file));
    }
  });

  test('the shell wraps its frame in the provider inside the existing providers, and its static imports never reach supabase-js', () => {
    const shell = read(SHELL_FILE);
    assert.match(shell, /^import \{ RealtimeSignalsProvider \} from '\.\.\/\.\.\/_ui\/realtime\/RealtimeSignals';$/m);
    assert.match(
      shell,
      /<ToastProvider>\s*<ConfirmProvider>\s*<RealtimeSignalsProvider>\s*<ShellFrame \{\.\.\.props\} \/>\s*<\/RealtimeSignalsProvider>\s*<\/ConfirmProvider>\s*<SessionExpiredHandler \/>\s*<\/ToastProvider>/,
    );
    for (const entry of [SHELL_FILE, UI_INDEX_FILE]) {
      const graph = staticGraph(entry);
      assert.ok(!graph.packages.has('@supabase/supabase-js'), rel(entry));
      assert.ok(!graph.files.has(TRANSPORT_FILE), rel(entry));
    }
    assert.ok(staticGraph(SHELL_FILE).files.has(PROVIDER_FILE));
    assert.doesNotMatch(read(UI_INDEX_FILE), /@supabase|supabaseTransport/);
  });
});

describe('the client mirrors the pass route and the database trigger', () => {
  test('topic keys and channel names match the server pass library', () => {
    const pairs = [...read(PASS_LIB_FILE).matchAll(/\{ key: '(\w+)', topic: '([\w:]+)', permission: '[\w.]+' \}/g)]
      .map(([, key, topic]) => [key, topic]);
    assert.equal(pairs.length, 2);
    assert.deepEqual(pairs, Object.entries(core.SIGNAL_TOPICS));
  });

  test('each table reaches the topic the trigger sends it on, with the event and payload keys the trigger builds', { skip: !existsSync(SCHEMA_FILE) }, () => {
    const sql = read(SCHEMA_FILE);
    const body = sql.match(/CREATE OR REPLACE FUNCTION trg_admin_realtime_signal\(\)([\s\S]*?)\n\$\$;/)?.[1] ?? '';
    assert.ok(body.length > 0);
    assert.match(body, /PERFORM realtime\.send\(\s*v_payload,\s*'changed',\s*CASE TG_TABLE_NAME WHEN 'card_submissions' THEN 'admin:cards' ELSE 'admin:withdrawals' END,\s*true\s*\);/);
    assert.ok(body.includes("jsonb_build_object('v', 1, 'table', TG_TABLE_NAME, 'id', v_new -> 'id', 'status', v_new -> 'status')"));
    assert.ok(body.includes("jsonb_build_object('withdrawal_id', v_new -> 'transaction_id')"));
    const tables = [...sql.matchAll(/CREATE TRIGGER trg_admin_realtime_\w+\s+AFTER [^;]*? ON (\w+)\s/g)].map((match) => match[1]).sort();
    assert.deepEqual(tables, Object.keys(core.SIGNAL_TABLE_TOPICS).sort());
    for (const table of tables) {
      const topic = table === 'card_submissions' ? 'cards' : 'withdrawals';
      assert.equal(core.SIGNAL_TABLE_TOPICS[table as keyof typeof core.SIGNAL_TABLE_TOPICS], topic, table);
      const extra = table === 'flagged_transactions' ? { withdrawal_id: WITHDRAWAL_ID } : {};
      assert.ok(core.readSignal(change(table, FLAG_ID, 'pending_review', extra), topic), table);
    }
  });
});
