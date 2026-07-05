'use client';

import { useEffect, useRef, useState } from 'react';
import {
  PageHeader, Card, CardHeader, CardBody, CardFooter,
  Table, THead, TBody, Tr, Th, Td, TableEmpty,
  Button, Input, Textarea, Select, FieldShell,
} from '../../_ui';
import { useIsMobile } from '../../lib/useIsMobile';
import { StatusDot } from '../_shared/statusUi';

const PER_USER_VARS: { token: string; hint: string }[] = [
  { token: 'first_name', hint: 'first word of full name' },
  { token: 'full_name', hint: 'users.full_name' },
  { token: 'username', hint: 'users.username' },
  { token: 'email', hint: 'users.email' },
  { token: 'phone', hint: 'users.phone' },
  { token: 'country', hint: 'users.country' },
  { token: 'referral_code', hint: 'users.referral_code' },
  { token: 'balance', hint: 'wallet balance, comma-formatted' },
];

const GLOBAL_VARS: { token: string; hint: string }[] = [
  { token: 'min_withdrawal', hint: 'app_config.min_withdrawal_amount' },
  { token: 'max_withdrawal', hint: 'app_config.max_withdrawal_amount' },
  { token: 'signup_bonus', hint: 'app_config.signup_bonus_amount' },
  { token: 'referral_bonus', hint: 'app_config.referral_referrer_bonus' },
  { token: 'app_version', hint: 'app_config.app_current_version' },
];

interface Broadcast {
  id: string;
  title: string;
  message: string;
  type: string;
  audience: string;
  recipient_count: number;
  delivered_count: number;
  failed_count: number;
  sent_at: string;
}

interface UserHit { id: string; full_name: string | null; username: string | null; email: string }

const AUDIENCES = [
  { value: 'all', label: 'All Users (in-app only)' },
  { value: 'all_anon', label: 'All Users + Anonymous' },
  { value: 'active_7d', label: 'Active in last 7 days' },
  { value: 'inactive', label: 'Inactive (7+ days)' },
  { value: 'specific', label: 'Specific User' },
];

const TYPES = [
  { value: 'general', label: 'General' },
  { value: 'promo', label: 'Promotional' },
  { value: 'update', label: 'Product Update' },
  { value: 'system', label: 'System' },
];

function BroadcastsMobile({ history, loading }: { history: Broadcast[]; loading: boolean }) {
  if (loading) {
    return (
      <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-default)', borderRadius: 'var(--radius-xl)', padding: '48px 20px', textAlign: 'center', color: 'var(--fg-tertiary)', fontSize: 'var(--text-md)' }}>
        Loading…
      </div>
    );
  }
  if (history.length === 0) {
    return (
      <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-default)', borderRadius: 'var(--radius-xl)', padding: '48px 20px', textAlign: 'center', color: 'var(--fg-tertiary)', fontSize: 'var(--text-md)' }}>
        No broadcasts yet.
      </div>
    );
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {history.map((b) => (
        <div key={b.id} style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-default)', borderRadius: 'var(--radius-xl)', padding: 14 }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10 }}>
            <div style={{ fontSize: 'var(--text-md)', fontWeight: 700, color: 'var(--fg-primary)', minWidth: 0 }}>{b.title}</div>
            <StatusDot status={b.audience} tone="neutral" />
          </div>
          <div style={{ fontSize: 'var(--text-sm)', color: 'var(--fg-secondary)', marginTop: 4 }}>
            {b.message.length > 60 ? b.message.slice(0, 60) + '…' : b.message}
          </div>
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 10, marginTop: 10 }}>
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-md)', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{b.delivered_count}/{b.recipient_count}</span>
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)', color: 'var(--fg-tertiary)' }}>{new Date(b.sent_at).toLocaleString()}</span>
          </div>
        </div>
      ))}
    </div>
  );
}

export default function NotificationsBroadcastPage() {
  const isMobile = useIsMobile();
  const [history, setHistory] = useState<Broadcast[]>([]);
  const [loading, setLoading] = useState(true);
  const [audience, setAudience] = useState('all');
  const [type, setType] = useState('general');
  const [title, setTitle] = useState('');
  const [message, setMessage] = useState('');
  const [count, setCount] = useState<number | null>(null);
  const [sending, setSending] = useState(false);
  const [toast, setToast] = useState('');

  const [userQuery, setUserQuery] = useState('');
  const [userHits, setUserHits] = useState<UserHit[]>([]);
  const [selectedUser, setSelectedUser] = useState<UserHit | null>(null);

  const titleRef = useRef<HTMLInputElement | null>(null);
  const messageRef = useRef<HTMLTextAreaElement | null>(null);
  const lastFocused = useRef<'title' | 'message'>('message');

  const insertToken = (token: string) => {
    const wrapped = `{${token}}`;
    if (lastFocused.current === 'title') {
      const el = titleRef.current;
      const start = el?.selectionStart ?? title.length;
      const end = el?.selectionEnd ?? title.length;
      const next = title.slice(0, start) + wrapped + title.slice(end);
      setTitle(next);
      setTimeout(() => {
        el?.focus();
        const pos = start + wrapped.length;
        el?.setSelectionRange(pos, pos);
      }, 0);
    } else {
      const el = messageRef.current;
      const start = el?.selectionStart ?? message.length;
      const end = el?.selectionEnd ?? message.length;
      const next = message.slice(0, start) + wrapped + message.slice(end);
      setMessage(next);
      setTimeout(() => {
        el?.focus();
        const pos = start + wrapped.length;
        el?.setSelectionRange(pos, pos);
      }, 0);
    }
  };

  useEffect(() => { fetchHistory(); }, []);

  useEffect(() => {
    if (audience === 'specific') {
      setCount(selectedUser ? 1 : 0);
      return;
    }
    setCount(null);
    fetch(`/api/notifications/recipient-count?audience=${audience}`)
      .then((r) => r.json()).then((d) => setCount(d.count ?? 0)).catch(() => setCount(0));
  }, [audience, selectedUser]);

  useEffect(() => {
    if (audience !== 'specific' || !userQuery.trim()) { setUserHits([]); return; }
    const t = setTimeout(() => {
      fetch(`/api/notifications/user-search?q=${encodeURIComponent(userQuery)}`)
        .then((r) => r.json()).then((d) => setUserHits(d.users || [])).catch(() => setUserHits([]));
    }, 250);
    return () => clearTimeout(t);
  }, [userQuery, audience]);

  const fetchHistory = async () => {
    setLoading(true);
    const res = await fetch('/api/notifications/broadcast');
    const data = await res.json().catch(() => ({}));
    setHistory(data.broadcasts || []);
    setLoading(false);
  };

  const showToast = (msg: string) => { setToast(msg); setTimeout(() => setToast(''), 3000); };

  const send = async () => {
    if (!title.trim() || !message.trim()) return showToast('Title and message required');
    if (audience === 'specific' && !selectedUser) return showToast('Pick a user');
    setSending(true);
    const res = await fetch('/api/notifications/broadcast', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title, message, type, audience,
        target_user_id: audience === 'specific' ? selectedUser?.id : null,
      }),
    });
    const data = await res.json().catch(() => ({}));
    setSending(false);
    if (!res.ok) return showToast(data?.error || 'Broadcast failed');
    showToast(`Sent to ${data.recipient_count ?? 0} users`);
    setTitle(''); setMessage(''); setSelectedUser(null); setUserQuery('');
    fetchHistory();
  };

  const chipStyle: React.CSSProperties = {
    fontSize: 'var(--text-xs)', fontWeight: 600, padding: '4px 8px',
    background: 'var(--bg-surface)', border: '1px solid var(--border-default)',
    borderRadius: 'var(--radius-md)', cursor: 'pointer',
    fontFamily: 'var(--font-mono)', color: 'var(--fg-primary)',
  };
  const microLabel: React.CSSProperties = {
    fontFamily: 'var(--font-mono)', fontSize: 10.5, letterSpacing: '0.11em',
    textTransform: 'uppercase', color: 'var(--fg-tertiary)', margin: '10px 0 6px',
  };

  return (
    <div>
      <PageHeader
        title="Notifications Broadcast"
        subtitle="Compose and send targeted push broadcasts, then review delivery history."
      />

      <Card style={{ marginBottom: 'var(--space-4)' }}>
        <CardHeader title="Compose Broadcast" />
        <CardBody>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 12 }}>
            <FieldShell label="Audience">
              <Select value={audience} onChange={(e) => setAudience(e.target.value)}>
                {AUDIENCES.map((a) => <option key={a.value} value={a.value}>{a.label}</option>)}
              </Select>
            </FieldShell>
            <FieldShell label="Type">
              <Select value={type} onChange={(e) => setType(e.target.value)}>
                {TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
              </Select>
            </FieldShell>
          </div>

          {audience === 'specific' && (
            <div style={{ marginTop: 12, position: 'relative' }}>
              <FieldShell label="Search User">
                {selectedUser ? (
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, padding: '8px 10px', fontSize: 'var(--text-sm)', border: '1px solid var(--border-strong)', borderRadius: 'var(--radius-md)', background: 'var(--bg-subtle)' }}>
                    <span>{selectedUser.full_name || selectedUser.username} — {selectedUser.email}</span>
                    <Button variant="ghost" size="sm" onClick={() => { setSelectedUser(null); setUserQuery(''); }}>Clear</Button>
                  </div>
                ) : (
                  <>
                    <Input
                      placeholder="Username, email, or name"
                      value={userQuery}
                      onChange={(e) => setUserQuery(e.target.value)}
                    />
                    {userHits.length > 0 && (
                      <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, background: 'var(--bg-surface)', border: '1px solid var(--border-default)', borderRadius: 'var(--radius-md)', marginTop: 2, maxHeight: 200, overflowY: 'auto', zIndex: 10, boxShadow: 'var(--shadow-md)' }}>
                        {userHits.map((u) => (
                          <div key={u.id} style={{ padding: '8px 10px', cursor: 'pointer', borderBottom: '1px solid var(--border-subtle)' }} onClick={() => { setSelectedUser(u); setUserHits([]); }}>
                            <div style={{ fontWeight: 600, fontSize: 'var(--text-sm)' }}>{u.full_name || u.username}</div>
                            <div style={{ fontSize: 'var(--text-xs)', color: 'var(--fg-tertiary)' }}>{u.email}</div>
                          </div>
                        ))}
                      </div>
                    )}
                  </>
                )}
              </FieldShell>
            </div>
          )}

          <div style={{ marginTop: 12 }}>
            <FieldShell label="Title">
              <Input
                ref={titleRef}
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                onFocus={() => { lastFocused.current = 'title'; }}
                maxLength={80}
              />
            </FieldShell>
          </div>

          <div style={{ marginTop: 12 }}>
            <FieldShell label="Message">
              <Textarea
                ref={messageRef}
                style={{ minHeight: 90, resize: 'vertical' }}
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                onFocus={() => { lastFocused.current = 'message'; }}
                maxLength={500}
              />
            </FieldShell>
          </div>

          <div style={{ marginTop: 14, padding: 12, border: '1px dashed var(--border-default)', borderRadius: 'var(--radius-lg)', background: 'var(--bg-subtle)' }}>
            <p style={{ fontSize: 'var(--text-sm)', fontWeight: 700, color: 'var(--fg-primary)', margin: '0 0 8px' }}>Variables — click to insert at cursor</p>

            <p style={microLabel}>Per-user (substituted for each recipient)</p>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {PER_USER_VARS.map((v) => (
                <button
                  key={v.token}
                  type="button"
                  style={chipStyle}
                  title={v.hint}
                  onClick={() => insertToken(v.token)}
                >
                  {`{${v.token}}`}
                </button>
              ))}
            </div>

            <p style={microLabel}>App config (same for everyone)</p>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {GLOBAL_VARS.map((v) => (
                <button
                  key={v.token}
                  type="button"
                  style={chipStyle}
                  title={v.hint}
                  onClick={() => insertToken(v.token)}
                >
                  {`{${v.token}}`}
                </button>
              ))}
            </div>
          </div>
        </CardBody>
        <CardFooter style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontSize: 'var(--text-sm)', color: 'var(--fg-secondary)' }}>
            Recipients: <strong style={{ fontFamily: 'var(--font-mono)', fontVariantNumeric: 'tabular-nums', color: 'var(--fg-primary)' }}>{count === null ? '…' : count.toLocaleString()}</strong>
          </span>
          <Button variant="primary" size="sm" onClick={send} disabled={sending} loading={sending}>
            {sending ? 'Sending…' : 'Send Broadcast'}
          </Button>
        </CardFooter>
      </Card>

      {isMobile ? (
        <>
          <p style={{ ...microLabel, margin: '0 0 8px' }}>Recent Broadcasts</p>
          <BroadcastsMobile history={history} loading={loading} />
        </>
      ) : (
        <Card>
          <CardHeader title="Recent Broadcasts" />
          <CardBody flush>
            <Table flush>
              <THead>
                <Tr>
                  <Th>Title</Th>
                  <Th>Message</Th>
                  <Th>Audience</Th>
                  <Th align="right">Delivered</Th>
                  <Th>Sent</Th>
                </Tr>
              </THead>
              <TBody>
                {loading ? (
                  <TableEmpty colSpan={5}>Loading…</TableEmpty>
                ) : history.length === 0 ? (
                  <TableEmpty colSpan={5}>No broadcasts yet.</TableEmpty>
                ) : history.map((b) => (
                  <Tr key={b.id}>
                    <Td emphasis="primary">{b.title}</Td>
                    <Td emphasis="secondary">{b.message.length > 60 ? b.message.slice(0, 60) + '…' : b.message}</Td>
                    <Td><StatusDot status={b.audience} tone="neutral" /></Td>
                    <Td align="right" mono>{b.delivered_count}/{b.recipient_count}</Td>
                    <Td emphasis="secondary" mono>{new Date(b.sent_at).toLocaleString()}</Td>
                  </Tr>
                ))}
              </TBody>
            </Table>
          </CardBody>
        </Card>
      )}

      {toast && (
        <div style={{ position: 'fixed', bottom: 24, right: 24, background: 'var(--fg-primary)', color: 'var(--bg-base)', padding: '10px 18px', borderRadius: 'var(--radius-lg)', fontSize: 'var(--text-sm)', fontWeight: 600, zIndex: 51 }}>
          {toast}
        </div>
      )}
    </div>
  );
}
