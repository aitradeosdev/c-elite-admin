import { isUuid } from '../../lib/http';
import type { ApiResult } from '../../lib/apiClient';
import type { RealtimeTopic, RealtimeTopicKey } from '../../lib/realtimePass';

export type SignalTopic = RealtimeTopicKey;

export type SignalTable = 'withdrawals' | 'card_submissions' | 'flagged_transactions';

export interface SignalChange {
  kind: 'signal';
  table: SignalTable;
  id: string;
  status: string;
  withdrawalId?: string;
}

export interface SignalResync {
  kind: 'resync';
}

export type RealtimeSignal = SignalChange | SignalResync;

export type SignalListener = (signal: RealtimeSignal) => void;

export type SignalStatus = 'off' | 'connecting' | 'live' | 'fallback';

export type SignalPause = 'reconnecting' | 'disabled' | 'stopped';

export type ChannelStatus = 'SUBSCRIBED' | 'TIMED_OUT' | 'CHANNEL_ERROR' | 'CLOSED';

export interface SignalsTransport {
  connect(url: string, key: string, token: string): Promise<void>;
  setAuth(token: string): Promise<void>;
  join(
    topic: RealtimeTopic,
    onMessage: (payload: unknown) => void,
    onStatus: (status: ChannelStatus, reason: string | null) => void,
  ): void;
  leave(topic: RealtimeTopic): Promise<void>;
  disconnect(): Promise<void>;
}

export interface SignalsEnvironment {
  now: () => number;
  setTimer: (callback: () => void, ms: number) => unknown;
  clearTimer: (handle: unknown) => void;
  isHidden: () => boolean;
  onVisibility: (callback: () => void) => () => void;
}

export interface SignalsEngineOptions {
  fetchPass: () => Promise<ApiResult<unknown>>;
  loadTransport: () => Promise<SignalsTransport>;
  environment?: Partial<SignalsEnvironment>;
}

export interface SignalPass {
  url: string;
  key: string;
  token: string;
  topics: readonly RealtimeTopic[];
  receivedAt: number;
  renewAt: number;
  expiresAt: number;
}

export type PassOffReason = 'signed-out' | 'denied' | 'disabled';

export type PassOutcome =
  | { kind: 'pass'; pass: SignalPass }
  | { kind: 'off'; reason: PassOffReason }
  | { kind: 'retry' };

export const SIGNAL_TOPICS: Readonly<Record<SignalTopic, RealtimeTopic>> = {
  withdrawals: 'admin:withdrawals',
  cards: 'admin:cards',
};

export const SIGNAL_TABLE_TOPICS: Readonly<Record<SignalTable, SignalTopic>> = {
  withdrawals: 'withdrawals',
  card_submissions: 'cards',
  flagged_transactions: 'withdrawals',
};

export const SIGNAL_EVENT = 'changed';
export const PASS_RENEW_FRACTION = 0.8;
export const PASS_MAX_SECONDS = 3600;
export const TOPIC_LINGER_MS = 5000;
export const JOIN_WATCHDOG_MS = 30000;
export const STABLE_JOIN_MS = 60000;
export const CHANNEL_RETRY_MS: readonly number[] = [2000, 5000, 10000, 30000, 60000];
export const PASS_RETRY_MS: readonly number[] = [5000, 10000, 30000, 60000];
export const REFUSALS_BEFORE_STOP = 3;

const TOPIC_KEYS: readonly SignalTopic[] = ['withdrawals', 'cards'];
const DENIED_REASON = /permissions to read/i;
const STATUS_TOKEN = /^[a-z_]{1,32}$/;
const TOKEN_SHAPE = /^[\w-]+\.[\w-]+\.[\w-]+$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isSignalTable(value: unknown): value is SignalTable {
  return value === 'withdrawals' || value === 'card_submissions' || value === 'flagged_transactions';
}

function isRealtimeTopic(value: unknown): value is RealtimeTopic {
  return TOPIC_KEYS.some((key) => SIGNAL_TOPICS[key] === value);
}

function wholeSeconds(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) ? value : null;
}

function httpsUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  try {
    return new URL(value).protocol === 'https:' ? value : null;
  } catch {
    return null;
  }
}

function passTopics(value: unknown): RealtimeTopic[] | null {
  if (!Array.isArray(value)) return null;
  const topics: RealtimeTopic[] = [];
  for (const item of value) {
    if (isRealtimeTopic(item) && !topics.includes(item)) topics.push(item);
  }
  return topics;
}

export function readSignal(payload: unknown, topic: SignalTopic): SignalChange | null {
  if (!isRecord(payload) || payload.v !== 1) return null;
  const { table, id, status } = payload;
  const withdrawalId = payload.withdrawal_id;
  if (!isSignalTable(table) || SIGNAL_TABLE_TOPICS[table] !== topic) return null;
  if (!isUuid(id) || typeof status !== 'string' || !STATUS_TOKEN.test(status)) return null;
  if (table === 'flagged_transactions') {
    return isUuid(withdrawalId) ? { kind: 'signal', table, id, status, withdrawalId } : null;
  }
  if (withdrawalId !== undefined && !isUuid(withdrawalId)) return null;
  return { kind: 'signal', table, id, status };
}

export function readPass(result: ApiResult<unknown>, now: number): PassOutcome {
  if (!result.ok) {
    const { kind, status } = result.error;
    if (kind !== 'http' || status === null || status === 429 || status >= 500) return { kind: 'retry' };
    if (status === 401) return { kind: 'off', reason: 'signed-out' };
    return { kind: 'off', reason: status === 403 ? 'denied' : 'disabled' };
  }
  const body = result.data;
  if (!isRecord(body) || body.enabled !== true) return { kind: 'off', reason: 'disabled' };
  const url = httpsUrl(body.url);
  const rawKey = body.key;
  const key = typeof rawKey === 'string' ? rawKey.trim() : '';
  const rawToken = body.token;
  const token = typeof rawToken === 'string' && TOKEN_SHAPE.test(rawToken) ? rawToken : null;
  const topics = passTopics(body.topics);
  const expiresAt = wholeSeconds(body.expires_at);
  const issuedAt = body.issued_at === undefined ? Math.floor(now / 1000) : wholeSeconds(body.issued_at);
  if (url === null || key === '' || token === null || topics === null || expiresAt === null || issuedAt === null) {
    return { kind: 'off', reason: 'disabled' };
  }
  const lifetime = expiresAt - issuedAt;
  if (lifetime <= 0 || lifetime > PASS_MAX_SECONDS) return { kind: 'off', reason: 'disabled' };
  const lifetimeMs = lifetime * 1000;
  return {
    kind: 'pass',
    pass: {
      url,
      key,
      token,
      topics,
      receivedAt: now,
      renewAt: now + Math.round(lifetimeMs * PASS_RENEW_FRACTION),
      expiresAt: now + lifetimeMs,
    },
  };
}

type ChannelState = 'none' | 'joining' | 'joined' | 'failed' | 'leaving';

interface ListenerEntry {
  listener: SignalListener;
}

interface TopicState {
  readonly key: SignalTopic;
  readonly wire: RealtimeTopic;
  readonly listeners: Set<ListenerEntry>;
  lingerUntil: number | null;
  channel: ChannelState;
  joinId: number;
  joinDeadline: number | null;
  joinedAt: number | null;
  terminal: boolean;
  failed: boolean;
  refusals: number;
  attempt: number;
  retryAt: number | null;
}

type Step = () => void | Promise<void>;

const DEFAULT_ENVIRONMENT: SignalsEnvironment = {
  now: () => Date.now(),
  setTimer: (callback, ms) => setTimeout(callback, ms),
  clearTimer: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
  isHidden: () => typeof document !== 'undefined' && document.visibilityState === 'hidden',
  onVisibility: (callback) => {
    if (typeof window === 'undefined') return () => {};
    window.addEventListener('visibilitychange', callback, true);
    return () => window.removeEventListener('visibilitychange', callback, true);
  },
};

function topicState(key: SignalTopic): TopicState {
  return {
    key,
    wire: SIGNAL_TOPICS[key],
    listeners: new Set(),
    lingerUntil: null,
    channel: 'none',
    joinId: 0,
    joinDeadline: null,
    joinedAt: null,
    terminal: false,
    failed: false,
    refusals: 0,
    attempt: 0,
    retryAt: null,
  };
}

function ladder(steps: readonly number[], index: number): number {
  return steps[Math.min(index, steps.length - 1)];
}

function sameTopics(a: readonly RealtimeTopic[], b: readonly RealtimeTopic[]): boolean {
  return a.length === b.length && a.every((topic) => b.includes(topic));
}

function endpointOf(pass: SignalPass): string {
  return `${pass.url} ${pass.key}`;
}

export class SignalsEngine {
  private readonly env: SignalsEnvironment;
  private readonly fetchPass: () => Promise<ApiResult<unknown>>;
  private readonly loadTransport: () => Promise<SignalsTransport>;
  private readonly topics: Readonly<Record<SignalTopic, TopicState>> = {
    withdrawals: topicState('withdrawals'),
    cards: topicState('cards'),
  };
  private readonly states: readonly TopicState[] = TOPIC_KEYS.map((key) => this.topics[key]);
  private readonly watchers = new Set<() => void>();
  private readonly published: Record<SignalTopic, SignalStatus> = { withdrawals: 'off', cards: 'off' };
  private readonly pauses: Record<SignalTopic, SignalPause | null> = { withdrawals: null, cards: null };
  private phase: 'active' | 'off' | 'disposed' = 'active';
  private offReason: PassOffReason | null = null;
  private pass: SignalPass | null = null;
  private fetching = false;
  private passFailures = 0;
  private passRetryAt: number | null = null;
  private transport: SignalsTransport | null = null;
  private loading = false;
  private connected = false;
  private endpoint: string | null = null;
  private authToken: string | null = null;
  private hidden = false;
  private stopVisibility: (() => void) | null = null;
  private wake: { handle: unknown; at: number } | null = null;
  private draining = false;
  private dirty = false;

  constructor(options: SignalsEngineOptions) {
    this.env = { ...DEFAULT_ENVIRONMENT, ...options.environment };
    this.fetchPass = options.fetchPass;
    this.loadTransport = options.loadTransport;
  }

  subscribe(topic: SignalTopic, listener: SignalListener): () => void {
    const state = this.topics[topic];
    if (!state || this.phase === 'disposed') return () => {};
    this.watchVisibility();
    const entry: ListenerEntry = { listener };
    state.listeners.add(entry);
    state.lingerUntil = null;
    this.kick();
    return () => {
      if (!state.listeners.delete(entry)) return;
      if (state.listeners.size === 0) state.lingerUntil = this.env.now() + TOPIC_LINGER_MS;
      this.kick();
    };
  }

  status(topic: SignalTopic): SignalStatus {
    return this.published[topic] ?? 'off';
  }

  pause(topic: SignalTopic): SignalPause | null {
    return this.pauses[topic] ?? null;
  }

  watch(listener: () => void): () => void {
    this.watchers.add(listener);
    return () => {
      this.watchers.delete(listener);
    };
  }

  dispose(): void {
    if (this.phase === 'disposed') return;
    this.phase = 'disposed';
    this.stopVisibility?.();
    this.stopVisibility = null;
    this.clearWake();
    for (const state of this.states) {
      state.listeners.clear();
      state.lingerUntil = null;
    }
    this.kick();
    this.watchers.clear();
  }

  private watchVisibility(): void {
    if (this.stopVisibility) return;
    this.hidden = this.env.isHidden();
    this.stopVisibility = this.env.onVisibility(() => this.visibilityChanged());
  }

  private visibilityChanged(): void {
    const wasHidden = this.hidden;
    this.hidden = this.env.isHidden();
    if (wasHidden && !this.hidden && this.phase === 'active') {
      for (const state of this.states) {
        if (state.channel === 'joined' && this.granted(state)) this.emit(state, { kind: 'resync' });
      }
    }
    this.kick();
  }

  private granted(state: TopicState): boolean {
    return this.pass !== null && this.pass.topics.includes(state.wire);
  }

  private staleEndpoint(): boolean {
    return this.connected && this.pass !== null && this.endpoint !== endpointOf(this.pass);
  }

  private keeps(state: TopicState, now: number): boolean {
    if (this.phase !== 'active' || state.terminal || !this.granted(state) || this.staleEndpoint()) return false;
    return state.listeners.size > 0 || (state.lingerUntil !== null && now < state.lingerUntil);
  }

  private demanded(state: TopicState): boolean {
    if (this.phase !== 'active' || state.terminal || state.listeners.size === 0) return false;
    return this.pass === null || this.granted(state);
  }

  private joinable(state: TopicState, now: number): boolean {
    const pass = this.pass;
    return !this.hidden
      && pass !== null
      && now < pass.renewAt
      && state.channel === 'none'
      && this.demanded(state)
      && this.granted(state)
      && (state.retryAt === null || now >= state.retryAt);
  }

  private channels(): number {
    return this.states.filter((state) => state.channel !== 'none').length;
  }

  private nextStep(): Step | null {
    const now = this.env.now();
    for (const state of this.states) {
      if (state.channel === 'joining' && state.joinDeadline !== null && now >= state.joinDeadline) {
        this.channelStatus(state, state.joinId, 'TIMED_OUT', null);
      }
    }
    const transport = this.transport;
    for (const state of this.states) {
      const stale = state.channel === 'failed'
        || ((state.channel === 'joining' || state.channel === 'joined') && !this.keeps(state, now));
      if (!stale) continue;
      if (!transport) {
        state.channel = 'none';
        continue;
      }
      return () => this.leave(transport, state);
    }
    if (transport && this.connected && this.channels() === 0
      && (this.staleEndpoint() || !this.states.some((state) => this.joinable(state, now)))) {
      return () => this.disconnect(transport);
    }
    if (this.phase !== 'active') return null;
    const pass = this.pass;
    if (transport && this.connected && pass && this.authToken !== pass.token && now < pass.expiresAt) {
      return () => this.setAuth(transport, pass.token);
    }
    if (this.hidden || !this.states.some((state) => this.demanded(state))) return null;
    if (!this.fetching && (pass === null || now >= pass.renewAt)
      && (this.passRetryAt === null || now >= this.passRetryAt)) {
      return () => this.requestPass();
    }
    if (pass === null) return null;
    const next = this.states.find((state) => this.joinable(state, now));
    if (!next) return null;
    if (!transport) return this.loading ? null : () => this.load();
    if (!this.connected) return () => this.connect(transport, pass);
    return () => this.join(transport, next);
  }

  private settleJoined(state: TopicState): void {
    if (state.channel === 'joined' && state.joinedAt !== null && this.env.now() - state.joinedAt >= STABLE_JOIN_MS) {
      state.attempt = 0;
    }
    state.joinedAt = null;
  }

  private async leave(transport: SignalsTransport, state: TopicState): Promise<void> {
    this.settleJoined(state);
    state.channel = 'leaving';
    state.joinId += 1;
    state.joinDeadline = null;
    try {
      await transport.leave(state.wire);
    } catch {}
    state.channel = 'none';
    if (this.connected && this.channels() === 0) await this.disconnect(transport);
  }

  private async disconnect(transport: SignalsTransport): Promise<void> {
    this.connected = false;
    this.endpoint = null;
    this.authToken = null;
    try {
      await transport.disconnect();
    } catch {}
  }

  private async setAuth(transport: SignalsTransport, token: string): Promise<void> {
    this.authToken = token;
    try {
      await transport.setAuth(token);
    } catch {}
  }

  private requestPass(): void {
    this.fetching = true;
    void this.settlePass();
  }

  private async settlePass(): Promise<void> {
    let outcome: PassOutcome;
    try {
      outcome = readPass(await this.fetchPass(), this.env.now());
    } catch {
      outcome = { kind: 'retry' };
    }
    this.fetching = false;
    if (this.phase === 'active') this.applyPass(outcome);
    this.kick();
  }

  private applyPass(outcome: PassOutcome): void {
    if (outcome.kind === 'off') {
      this.offReason = outcome.reason;
      this.goOff();
      return;
    }
    if (outcome.kind === 'retry') {
      this.passRetryAt = this.env.now() + ladder(PASS_RETRY_MS, this.passFailures);
      this.passFailures += 1;
      for (const state of this.states) {
        if (state.listeners.size > 0 && state.channel !== 'joined') state.failed = true;
      }
      return;
    }
    const previous = this.pass;
    this.pass = outcome.pass;
    this.passFailures = 0;
    this.passRetryAt = null;
    if (previous && !sameTopics(previous.topics, outcome.pass.topics)) {
      for (const state of this.states) {
        state.terminal = false;
        state.refusals = 0;
        state.attempt = 0;
        state.retryAt = null;
      }
    }
  }

  private goOff(): void {
    if (this.phase !== 'active') return;
    this.phase = 'off';
    this.passRetryAt = null;
    this.kick();
  }

  private load(): void {
    this.loading = true;
    void this.settleLoad();
  }

  private async settleLoad(): Promise<void> {
    let transport: SignalsTransport | null;
    try {
      transport = await this.loadTransport();
    } catch {
      transport = null;
    }
    this.loading = false;
    if (transport) this.transport = transport;
    else this.goOff();
    this.kick();
  }

  private async connect(transport: SignalsTransport, pass: SignalPass): Promise<void> {
    this.connected = true;
    this.endpoint = endpointOf(pass);
    this.authToken = pass.token;
    try {
      await transport.connect(pass.url, pass.key, pass.token);
    } catch {
      await this.disconnect(transport);
      const now = this.env.now();
      for (const state of this.states) {
        if (this.joinable(state, now)) this.fail(state, null);
      }
    }
  }

  private join(transport: SignalsTransport, state: TopicState): void {
    state.channel = 'joining';
    state.joinId += 1;
    state.joinDeadline = this.env.now() + JOIN_WATCHDOG_MS;
    const id = state.joinId;
    try {
      transport.join(
        state.wire,
        (payload) => this.channelMessage(state, id, payload),
        (status, reason) => this.channelStatus(state, id, status, reason),
      );
    } catch {
      this.channelStatus(state, id, 'CHANNEL_ERROR', null);
    }
  }

  private channelMessage(state: TopicState, id: number, payload: unknown): void {
    if (state.joinId !== id || state.channel !== 'joined' || this.phase !== 'active') return;
    const signal = readSignal(payload, state.key);
    if (signal) this.emit(state, signal);
  }

  private channelStatus(state: TopicState, id: number, status: ChannelStatus, reason: string | null): void {
    if (state.joinId !== id) return;
    if (status === 'SUBSCRIBED') {
      if (state.channel !== 'joining') return;
      state.channel = 'joined';
      state.joinDeadline = null;
      state.joinedAt = this.env.now();
      state.failed = false;
      state.refusals = 0;
      state.retryAt = null;
      this.emit(state, { kind: 'resync' });
    } else {
      if (state.channel !== 'joining' && state.channel !== 'joined') return;
      this.settleJoined(state);
      state.channel = 'failed';
      state.joinDeadline = null;
      this.fail(state, status === 'CHANNEL_ERROR' ? reason : null);
    }
    this.kick();
  }

  private fail(state: TopicState, reason: string | null): void {
    state.failed = true;
    state.retryAt = null;
    if (reason !== null) {
      state.refusals += 1;
      if (DENIED_REASON.test(reason) || state.refusals >= REFUSALS_BEFORE_STOP) {
        state.terminal = true;
        return;
      }
    }
    if (this.hidden) return;
    state.retryAt = this.env.now() + ladder(CHANNEL_RETRY_MS, state.attempt);
    state.attempt += 1;
  }

  private emit(state: TopicState, signal: RealtimeSignal): void {
    for (const entry of Array.from(state.listeners)) {
      try {
        entry.listener(signal);
      } catch {}
    }
  }

  private statusOf(state: TopicState): SignalStatus {
    if (state.listeners.size === 0) return 'off';
    if (this.phase !== 'active' || state.terminal) return 'fallback';
    if (this.pass !== null && !this.granted(state)) return 'fallback';
    if (state.channel === 'joined') return 'live';
    return state.failed ? 'fallback' : 'connecting';
  }

  private pauseOf(state: TopicState, status: SignalStatus): SignalPause | null {
    if (status !== 'fallback') return null;
    if (this.phase === 'off' && this.offReason === 'disabled') return 'disabled';
    if (this.phase !== 'active' || state.terminal) return 'stopped';
    if (this.pass !== null && !this.granted(state)) return 'stopped';
    return 'reconnecting';
  }

  private publish(): void {
    let changed = false;
    for (const state of this.states) {
      const next = this.statusOf(state);
      const pause = this.pauseOf(state, next);
      if (this.published[state.key] === next && this.pauses[state.key] === pause) continue;
      this.published[state.key] = next;
      this.pauses[state.key] = pause;
      changed = true;
    }
    if (!changed) return;
    for (const watcher of Array.from(this.watchers)) {
      try {
        watcher();
      } catch {}
    }
  }

  private kick(): void {
    this.publish();
    this.dirty = true;
    if (this.draining) return;
    this.draining = true;
    void this.drain();
  }

  private async drain(): Promise<void> {
    while (this.dirty) {
      this.dirty = false;
      const step = this.nextStep();
      if (!step) continue;
      this.dirty = true;
      try {
        await step();
      } catch {}
      this.publish();
    }
    this.draining = false;
    this.publish();
    this.arm();
  }

  private nextWake(): number | null {
    if (this.phase !== 'active') return null;
    const now = this.env.now();
    const times: number[] = [];
    for (const state of this.states) {
      if (state.channel !== 'none' && state.listeners.size === 0 && state.lingerUntil !== null) {
        times.push(state.lingerUntil);
      }
      if (state.channel === 'joining' && state.joinDeadline !== null) times.push(state.joinDeadline);
      if (!this.hidden && state.channel === 'none' && state.retryAt !== null && this.demanded(state)) {
        times.push(state.retryAt);
      }
    }
    if (!this.hidden && !this.fetching && this.states.some((state) => this.demanded(state))) {
      if (this.passRetryAt !== null) times.push(this.passRetryAt);
      else if (this.pass !== null) times.push(this.pass.renewAt);
    }
    const future = times.filter((at) => at > now);
    return future.length > 0 ? Math.min(...future) : null;
  }

  private arm(): void {
    const at = this.nextWake();
    if (this.wake && this.wake.at === at) return;
    this.clearWake();
    if (at === null) return;
    const timer: { handle: unknown; at: number } = { handle: null, at };
    timer.handle = this.env.setTimer(() => {
      if (this.wake !== timer) return;
      this.wake = null;
      this.kick();
    }, Math.max(0, at - this.env.now()));
    this.wake = timer;
  }

  private clearWake(): void {
    const timer = this.wake;
    if (!timer) return;
    this.wake = null;
    this.env.clearTimer(timer.handle);
  }
}
