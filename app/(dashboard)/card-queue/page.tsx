'use client';

import { useEffect, useState, useCallback } from 'react';
import { Share2, X, ChevronLeft, ChevronRight } from 'lucide-react';
import {
  PageHeader, Card, CardBody, Badge, Table, THead, TBody, Tr, Th, Td, TableEmpty,
  Button, Input, Select, Textarea, Tabs, SidePanel, Modal,
} from '../../_ui';

type Status = 'all' | 'pending' | 'approved' | 'rejected' | 'disputed';

const TAB_ITEMS: ReadonlyArray<{ value: Status; label: string }> = [
  { value: 'all',       label: 'All' },
  { value: 'pending',   label: 'Pending' },
  { value: 'approved',  label: 'Approved' },
  { value: 'rejected',  label: 'Rejected' },
  { value: 'disputed',  label: 'Dispute queue' },
];

const CORRECTION_NOTES = [
  'Card partially redeemed — credited the actual usable balance',
  'Card face value differs from submitted amount',
  'Wrong card type selected — corrected to the right one',
  'Denomination mismatch — adjusted to match card value',
  'Partial approval — unusable portion excluded',
];

const REJECT_REASONS = [
  'Card already redeemed',
  'Invalid card code',
  'Card image unclear / unreadable',
  'Wrong card type selected',
  'Wrong denomination',
  'Duplicate submission',
];

function formatNaira(n: number | string | null | undefined) {
  const v = Number(n || 0);
  return '₦' + v.toLocaleString('en-NG', { minimumFractionDigits: 2 });
}

function statusTone(status: string): 'success' | 'warning' | 'danger' | 'neutral' {
  switch (status) {
    case 'approved': case 'dispute_resolved': return 'success';
    case 'pending': case 'disputed': return 'warning';
    case 'rejected': return 'danger';
    default: return 'neutral';
  }
}

function statusLabel(status: string) {
  if (status === 'dispute_resolved') return 'Resolved';
  return status.charAt(0).toUpperCase() + status.slice(1);
}

export default function CardQueuePage() {
  const [tab, setTab] = useState<Status>('pending');
  const [search, setSearch] = useState('');
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);

  const [detail, setDetail] = useState<any | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [showApprove, setShowApprove] = useState(false);
  const [showReject, setShowReject] = useState(false);
  const [rejectReason, setRejectReason] = useState('');
  const [rejectCustom, setRejectCustom] = useState('');
  const [busy, setBusy] = useState(false);

  const [lightbox, setLightbox] = useState<{ images: string[]; index: number } | null>(null);
  const [shareOpen, setShareOpen] = useState(false);

  const [corrType, setCorrType] = useState<string>('');
  const [corrAmount, setCorrAmount] = useState<string>('');
  const [correctOpen, setCorrectOpen] = useState(false);
  const [corrNote, setCorrNote] = useState<string>('');

  const buildShareText = (d: any): string => {
    const lines: string[] = [];
    if (d.cards?.name) lines.push(`Card: ${d.cards.name}`);
    const country = d.country_name || d.card_types?.country_code;
    if (country) lines.push(`Country: ${country}`);
    if (d.amount_foreign) lines.push(`Value: ${d.amount_foreign}`);
    if (d.submitted_fields) {
      Object.entries(d.submitted_fields).forEach(([k, v]) => {
        if (v && typeof v === 'string') lines.push(`${k}: ${v}`);
      });
    }
    return lines.join('\n');
  };

  const shareToWhatsApp = () => {
    const text = encodeURIComponent(buildShareText(detail));
    window.open(`https://wa.me/?text=${text}`, '_blank');
    setShareOpen(false);
  };

  const shareToTelegram = () => {
    const text = encodeURIComponent(buildShareText(detail));
    window.open(`https://t.me/share/url?url=${text}&text=${text}`, '_blank');
    setShareOpen(false);
  };

  const shareToEmail = () => {
    const text = encodeURIComponent(buildShareText(detail));
    const subject = encodeURIComponent(`Card Submission - ${detail.cards?.name || ''}`);
    window.location.href = `mailto:?subject=${subject}&body=${text}`;
    setShareOpen(false);
  };

  const copyText = async () => {
    await navigator.clipboard.writeText(buildShareText(detail));
    setShareOpen(false);
    alert('Copied to clipboard');
  };

  const shareWithImages = async () => {
    try {
      const text = buildShareText(detail);
      const files: File[] = [];
      if (detail.card_images && detail.card_images.length > 0) {
        for (let i = 0; i < detail.card_images.length; i++) {
          const url = detail.card_images[i];
          const blob = await fetch(url).then((r) => r.blob());
          const ext = (blob.type.split('/')[1] || 'jpg').split('+')[0];
          files.push(new File([blob], `card-${i + 1}.${ext}`, { type: blob.type || 'image/jpeg' }));
        }
      }
      const nav: any = navigator;
      if (!nav.share) {
        alert('Native share not supported in this browser. Use Download images instead.');
        return;
      }
      const payload: any = { text, title: detail.cards?.name || 'Card Submission' };
      if (files.length > 0 && nav.canShare && nav.canShare({ files })) {
        payload.files = files;
      } else if (files.length > 0) {
        alert('This browser cannot share image files. Falling back to text-only.');
      }
      await nav.share(payload);
      setShareOpen(false);
    } catch (e: any) {
      if (e?.name !== 'AbortError') alert('Share failed: ' + (e?.message || e));
    }
  };

  const downloadImages = async () => {
    if (!detail.card_images || detail.card_images.length === 0) return;
    for (let i = 0; i < detail.card_images.length; i++) {
      const url = detail.card_images[i];
      const blob = await fetch(url).then((r) => r.blob());
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `card-${i + 1}.${(blob.type.split('/')[1] || 'jpg')}`;
      document.body.appendChild(a);
      a.click();
      a.remove();
    }
    setShareOpen(false);
  };

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    const params = new URLSearchParams();
    if (tab !== 'all') params.set('status', tab);
    if (search) params.set('search', search);
    const res = await fetch('/api/card-queue?' + params.toString());
    const json = await res.json();
    setRows(json.submissions || []);
    if (!silent) setLoading(false);
  }, [tab, search]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    const id = setInterval(() => { load(true); }, 5000);
    return () => clearInterval(id);
  }, [load]);

  const openDetail = async (id: string) => {
    setDetailLoading(true);
    setDetail({ id });
    const res = await fetch('/api/card-queue?id=' + id);
    const json = await res.json();
    const sub = json.submission || null;
    setDetail(sub);
    setCorrType(sub?.card_types?.id || sub?.card_type_id || '');
    setCorrAmount(sub?.amount_foreign != null ? String(sub.amount_foreign) : '');
    setCorrectOpen(false);
    setCorrNote('');
    setDetailLoading(false);
  };

  const closeDetail = () => {
    setDetail(null);
    setShowApprove(false);
    setShowReject(false);
    setRejectReason('');
    setRejectCustom('');
  };

  const doAction = async (action: 'approve' | 'reject' | 'overturn' | 'uphold', reason?: string) => {
    if (!detail?.id) return;
    const payload: any = { action, submission_id: detail.id, reason };
    if ((action === 'approve' || action === 'overturn') && correctOpen) {
      const origTypeId = detail?.card_types?.id || detail?.card_type_id || '';
      const origAmount = detail?.amount_foreign != null ? String(detail.amount_foreign) : '';
      if (corrType && corrType !== origTypeId) payload.card_type_id = corrType;
      if (corrAmount && corrAmount !== origAmount) payload.amount_foreign = Number(corrAmount);
      if (corrNote.trim()) payload.correction_note = corrNote.trim();
    }
    setBusy(true);
    const res = await fetch('/api/card-queue', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const json = await res.json();
    setBusy(false);
    if (!res.ok) {
      alert(json.error || 'Action failed');
      return;
    }
    closeDetail();
    load();
  };

  const submitReject = () => {
    const reason = (rejectCustom.trim() || rejectReason).trim();
    if (!reason) { alert('Pick or enter a reason'); return; }
    doAction('reject', reason);
  };

  return (
    <div>
      <PageHeader
        title="Card queue"
        subtitle="Live submissions — auto-refreshes every 5 seconds."
      />

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 'var(--space-4)', gap: 12, flexWrap: 'wrap' }}>
        <Tabs<Status> value={tab} onChange={setTab} items={TAB_ITEMS} variant="underline" />
        <Input
          placeholder="Search user or card brand"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ minWidth: 260, maxWidth: 320 }}
        />
      </div>

      <Card>
        <CardBody flush>
          <Table flush>
            <THead>
              <Tr>
                <Th>User</Th>
                <Th>Card</Th>
                <Th>Country</Th>
                <Th>Type</Th>
                <Th align="right">Value</Th>
                <Th align="right">Payout</Th>
                <Th>Submitted</Th>
                <Th>Status</Th>
                <Th align="right">Actions</Th>
              </Tr>
            </THead>
            <TBody>
              {loading ? (
                <TableEmpty colSpan={9}>Loading…</TableEmpty>
              ) : rows.length === 0 ? (
                <TableEmpty colSpan={9}>No submissions</TableEmpty>
              ) : rows.map((r: any) => (
                <Tr key={r.id}>
                  <Td emphasis="primary">@{r.users?.username || '—'}</Td>
                  <Td>{r.cards?.name || '—'}</Td>
                  <Td emphasis="secondary">{r.card_types?.country_code || '—'}</Td>
                  <Td emphasis="secondary">{r.card_types?.name || '—'}</Td>
                  <Td align="right" mono>{r.amount_foreign || '—'}</Td>
                  <Td align="right" mono emphasis="primary">{formatNaira(r.payout_naira)}</Td>
                  <Td emphasis="secondary">{new Date(r.created_at).toLocaleString()}</Td>
                  <Td><Badge tone={statusTone(r.status)}>{statusLabel(r.status)}</Badge></Td>
                  <Td align="right">
                    <div style={{ display: 'inline-flex', gap: 6, justifyContent: 'flex-end' }}>
                      {r.status === 'pending' && (
                        <>
                          <Button variant="success" size="sm" onClick={() => { openDetail(r.id); setShowApprove(true); }}>
                            Approve
                          </Button>
                          <Button variant="dangerSubtle" size="sm" onClick={() => { openDetail(r.id); setShowReject(true); }}>
                            Reject
                          </Button>
                        </>
                      )}
                      <Button variant="ghost" size="sm" onClick={() => openDetail(r.id)}>View</Button>
                    </div>
                  </Td>
                </Tr>
              ))}
            </TBody>
          </Table>
        </CardBody>
      </Card>

      <SidePanel
        open={!!detail}
        onClose={closeDetail}
        title="Card submission"
        subtitle={detail?.users ? `@${detail.users.username}` : undefined}
      >
        {detailLoading || !detail?.users ? (
          <p style={{ color: 'var(--fg-tertiary)' }}>Loading…</p>
        ) : (
          <>
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 12, position: 'relative' }}>
              <Button variant="secondary" size="sm" leftIcon={<Share2 size={14} />} onClick={() => setShareOpen((v) => !v)}>
                Share
              </Button>
              {shareOpen && (
                <>
                  <div style={{ position: 'fixed', inset: 0, zIndex: 55 }} onClick={() => setShareOpen(false)} />
                  <div style={{
                    position: 'absolute', top: 38, right: 0, zIndex: 56,
                    background: 'var(--bg-surface)', border: '1px solid var(--border-default)',
                    borderRadius: 'var(--radius-lg)', boxShadow: 'var(--shadow-md)',
                    minWidth: 220, padding: 4,
                  }}>
                    {detail.card_images && detail.card_images.length > 0 && (
                      <ShareItem onClick={shareWithImages}>Share with images (native)</ShareItem>
                    )}
                    <ShareItem onClick={shareToWhatsApp}>WhatsApp (text only)</ShareItem>
                    <ShareItem onClick={shareToTelegram}>Telegram (text only)</ShareItem>
                    <ShareItem onClick={shareToEmail}>Email (text only)</ShareItem>
                    <ShareItem onClick={copyText}>Copy text</ShareItem>
                    {detail.card_images && detail.card_images.length > 0 && (
                      <ShareItem onClick={downloadImages}>Download images</ShareItem>
                    )}
                  </div>
                </>
              )}
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 12, paddingBottom: 14, borderBottom: '1px solid var(--border-subtle)' }}>
              <div style={{
                width: 44, height: 44, borderRadius: 'var(--radius-md)',
                background: 'var(--accent-base)', color: 'var(--accent-fg)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 16, fontWeight: 700, flex: 'none',
              }}>
                {(detail.users.full_name || '?').charAt(0).toUpperCase()}
              </div>
              <div>
                <p style={{ fontSize: 'var(--text-md)', fontWeight: 700, margin: 0, color: 'var(--fg-primary)' }}>{detail.users.full_name}</p>
                <p style={{ fontSize: 'var(--text-sm)', color: 'var(--fg-secondary)', margin: '2px 0 0' }}>{detail.users.email}</p>
                <p style={{ fontSize: 'var(--text-sm)', color: 'var(--fg-tertiary)', margin: '2px 0 0' }}>@{detail.users.username}</p>
              </div>
            </div>

            <div style={{ marginTop: 16 }}>
              <DetailRow label="Card" value={detail.cards?.name} />
              <DetailRow label="Country" value={detail.country_name || detail.card_types?.country_code} />
              <DetailRow label="Type" value={detail.card_types?.name} />
              <DetailRow label="Denomination" value={detail.denominations?.range_label} />
              <DetailRow label="Value" value={detail.amount_foreign} />
              <DetailRow label="Rate" value={detail.rate_at_submission} />
              <DetailRow label="Payout" value={formatNaira(detail.payout_naira)} bold />
              {detail.coupon_code && <DetailRow label="Coupon" value={`${detail.coupon_code} (+${formatNaira(detail.coupon_bonus)})`} />}
              <DetailRow label="Submitted" value={new Date(detail.created_at).toLocaleString()} />
              <DetailRow label="Status" value={<Badge tone={statusTone(detail.status)}>{statusLabel(detail.status)}</Badge>} />
            </div>

            {detail.submitted_fields && Object.keys(detail.submitted_fields).length > 0 && (
              <div style={{ marginTop: 18 }}>
                <SectionLabel>Submitted fields</SectionLabel>
                {Object.entries(detail.submitted_fields).map(([k, v]: [string, any]) => (
                  <DetailRow key={k} label={k} value={String(v)} />
                ))}
              </div>
            )}

            {detail.card_images && detail.card_images.length > 0 && (
              <div style={{ marginTop: 18 }}>
                <SectionLabel>Card images</SectionLabel>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                  {detail.card_images.map((url: string, i: number) => (
                    <img
                      key={i}
                      src={url}
                      alt=""
                      onClick={() => setLightbox({ images: detail.card_images, index: i })}
                      style={{
                        width: 120, height: 100, objectFit: 'cover',
                        border: '1px solid var(--border-default)', borderRadius: 'var(--radius-md)',
                        cursor: 'pointer',
                      }}
                    />
                  ))}
                </div>
              </div>
            )}

            {detail.status === 'disputed' && (
              <div style={{ marginTop: 18 }}>
                <div style={{
                  background: 'var(--tone-warning-bg)', border: '1px solid var(--tone-warning-border)',
                  borderRadius: 'var(--radius-lg)', padding: 14,
                }}>
                  <SectionLabel style={{ color: 'var(--tone-warning-fg)' }}>Dispute message</SectionLabel>
                  <p style={{ fontSize: 'var(--text-md)', margin: 0, color: 'var(--fg-primary)' }}>{detail.dispute_message}</p>
                </div>
                {detail.dispute_images && detail.dispute_images.length > 0 && (
                  <div style={{ marginTop: 12 }}>
                    <SectionLabel>Dispute evidence</SectionLabel>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                      {detail.dispute_images.map((url: string, i: number) => (
                        <img
                          key={i}
                          src={url}
                          alt=""
                          onClick={() => setLightbox({ images: detail.dispute_images, index: i })}
                          style={{
                            width: 120, height: 100, objectFit: 'cover',
                            border: '1px solid var(--border-default)', borderRadius: 'var(--radius-md)',
                            cursor: 'pointer',
                          }}
                        />
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            {detail.rejection_reason && detail.status !== 'pending' && (
              <div style={{ marginTop: 18 }}>
                <SectionLabel>Rejection reason</SectionLabel>
                <p style={{ fontSize: 'var(--text-md)', color: 'var(--fg-primary)', margin: 0 }}>{detail.rejection_reason}</p>
              </div>
            )}

            <div style={{ marginTop: 24, display: 'flex', gap: 10 }}>
              {detail.status === 'pending' && (
                <>
                  <Button variant="success" style={{ flex: 1 }} onClick={() => setShowApprove(true)} disabled={busy}>Approve</Button>
                  <Button variant="dangerSubtle" style={{ flex: 1 }} onClick={() => setShowReject(true)} disabled={busy}>Reject</Button>
                </>
              )}
              {detail.status === 'disputed' && (
                <>
                  <Button variant="success" style={{ flex: 1 }} onClick={() => setShowApprove(true)} disabled={busy}>Overturn (approve + credit)</Button>
                  <Button variant="dangerSubtle" style={{ flex: 1 }} onClick={() => doAction('uphold')} disabled={busy}>Uphold</Button>
                </>
              )}
            </div>

            {showReject && (
              <div style={{
                marginTop: 16, padding: 14, border: '1px solid var(--border-default)',
                borderRadius: 'var(--radius-lg)', background: 'var(--bg-subtle)',
              }}>
                <SectionLabel>Rejection reason</SectionLabel>
                {REJECT_REASONS.map((r) => (
                  <label key={r} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 'var(--text-md)', color: 'var(--fg-primary)', padding: '4px 0', cursor: 'pointer' }}>
                    <input type="radio" name="rej" checked={rejectReason === r} onChange={() => { setRejectReason(r); setRejectCustom(''); }} />
                    {r}
                  </label>
                ))}
                <Textarea
                  placeholder="Or enter a custom reason"
                  value={rejectCustom}
                  onChange={(e) => { setRejectCustom(e.target.value); setRejectReason(''); }}
                  style={{ marginTop: 10 }}
                />
                <Button variant="danger" style={{ width: '100%', marginTop: 10 }} disabled={busy} onClick={submitReject}>Confirm reject</Button>
              </div>
            )}
          </>
        )}
      </SidePanel>

      {showApprove && detail?.users && <ApproveModal
        detail={detail}
        busy={busy}
        correctOpen={correctOpen}
        setCorrectOpen={setCorrectOpen}
        corrType={corrType}
        setCorrType={setCorrType}
        corrAmount={corrAmount}
        setCorrAmount={setCorrAmount}
        corrNote={corrNote}
        setCorrNote={setCorrNote}
        onCancel={() => setShowApprove(false)}
        onConfirm={() => doAction(detail.status === 'disputed' ? 'overturn' : 'approve')}
      />}

      {lightbox && (
        <div
          onClick={() => setLightbox(null)}
          style={{
            position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.92)', zIndex: 2000,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}
        >
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); setLightbox(null); }}
            style={{
              position: 'absolute', top: 20, right: 20, background: 'rgba(255,255,255,0.18)',
              border: 0, color: '#FFF', width: 40, height: 40, borderRadius: 999,
              cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}
            aria-label="Close"
          >
            <X size={20} />
          </button>
          {lightbox.index > 0 && (
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); setLightbox({ ...lightbox, index: lightbox.index - 1 }); }}
              style={{ position: 'absolute', left: 24, top: '50%', transform: 'translateY(-50%)', background: 'rgba(255,255,255,0.18)', border: 0, color: '#FFF', width: 44, height: 44, borderRadius: 999, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
              aria-label="Previous"
            >
              <ChevronLeft size={20} />
            </button>
          )}
          <img
            src={lightbox.images[lightbox.index]}
            alt=""
            onClick={(e) => e.stopPropagation()}
            style={{ maxWidth: '92%', maxHeight: '92%', objectFit: 'contain' }}
          />
          {lightbox.index < lightbox.images.length - 1 && (
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); setLightbox({ ...lightbox, index: lightbox.index + 1 }); }}
              style={{ position: 'absolute', right: 24, top: '50%', transform: 'translateY(-50%)', background: 'rgba(255,255,255,0.18)', border: 0, color: '#FFF', width: 44, height: 44, borderRadius: 999, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
              aria-label="Next"
            >
              <ChevronRight size={20} />
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function DetailRow({ label, value, bold }: { label: string; value: any; bold?: boolean }) {
  return (
    <div style={{
      display: 'flex', justifyContent: 'space-between', alignItems: 'center',
      padding: '10px 0', borderBottom: '1px solid var(--border-subtle)', gap: 16,
    }}>
      <span style={{ fontSize: 'var(--text-sm)', color: 'var(--fg-tertiary)' }}>{label}</span>
      <span style={{
        fontSize: 'var(--text-md)', color: 'var(--fg-primary)',
        fontWeight: bold ? 700 : 500, textAlign: 'right',
        maxWidth: '60%', wordBreak: 'break-word',
      }}>{value ?? '—'}</span>
    </div>
  );
}

function SectionLabel({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <p style={{
      fontSize: 'var(--text-xs)', fontWeight: 700, color: 'var(--fg-tertiary)',
      textTransform: 'uppercase', letterSpacing: '0.06em', margin: '0 0 8px',
      ...style,
    }}>{children}</p>
  );
}

function ShareItem({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        display: 'block', width: '100%', textAlign: 'left', background: 'none', border: 0,
        padding: '10px 12px', fontSize: 'var(--text-md)', color: 'var(--fg-primary)',
        cursor: 'pointer', borderRadius: 'var(--radius-sm)',
      }}
      onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = 'var(--bg-subtle)'; }}
      onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
    >
      {children}
    </button>
  );
}

interface ApproveModalProps {
  detail: any;
  busy: boolean;
  correctOpen: boolean;
  setCorrectOpen: (v: boolean) => void;
  corrType: string;
  setCorrType: (v: string) => void;
  corrAmount: string;
  setCorrAmount: (v: string) => void;
  corrNote: string;
  setCorrNote: (v: string) => void;
  onCancel: () => void;
  onConfirm: () => void;
}

function ApproveModal({
  detail, busy, correctOpen, setCorrectOpen, corrType, setCorrType,
  corrAmount, setCorrAmount, corrNote, setCorrNote, onCancel, onConfirm,
}: ApproveModalProps) {
  const types: any[] = detail.card_types_for_card || [];
  const selectedType = types.find((t) => t.id === corrType);
  const amtNum = Number(corrAmount);
  let matchDenom: any = null;
  if (selectedType && Number.isFinite(amtNum) && amtNum > 0) {
    const denoms = selectedType.denominations || [];
    matchDenom = denoms
      .filter((d: any) => amtNum >= Number(d.min_value) && amtNum <= Number(d.max_value))
      .sort((a: any, b: any) => Number(b.min_value) - Number(a.min_value))[0] || null;
  }
  const newPayout = matchDenom ? Math.round(amtNum * Number(matchDenom.rate_naira) * 100) / 100 : null;
  const coupon = Number(detail.coupon_bonus || 0);
  const finalCredit = (correctOpen && newPayout != null)
    ? newPayout + coupon
    : Number(detail.payout_naira) + coupon;
  const origTypeId = detail?.card_types?.id || detail?.card_type_id || '';
  const origAmount = detail?.amount_foreign != null ? String(detail.amount_foreign) : '';
  const corrected = correctOpen && ((corrType && corrType !== origTypeId) || (corrAmount && corrAmount !== origAmount));
  const canConfirm = !corrected || (matchDenom != null && newPayout != null && corrNote.trim().length > 0);

  return (
    <Modal
      open
      onClose={onCancel}
      title="Approve and credit"
      size="md"
      footer={
        <>
          <Button variant="secondary" onClick={onCancel} disabled={busy}>Cancel</Button>
          <Button variant="success" onClick={onConfirm} loading={busy} disabled={!canConfirm}>Confirm</Button>
        </>
      }
    >
      <p style={{ fontSize: 'var(--text-md)', margin: '0 0 16px', color: 'var(--fg-primary)' }}>
        Credit <strong>{formatNaira(finalCredit)}</strong> to <strong>@{detail.users.username}</strong>?
      </p>

      {!correctOpen ? (
        <Button
          variant="ghost"
          style={{ width: '100%', border: '1px dashed var(--border-default)' }}
          onClick={() => setCorrectOpen(true)}
        >
          + Correct card type / amount
        </Button>
      ) : (
        <div style={{
          border: '1px solid var(--border-default)', borderRadius: 'var(--radius-lg)',
          padding: 14, background: 'var(--bg-subtle)',
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <SectionLabel style={{ margin: 0 }}>Correction</SectionLabel>
            <Button variant="ghost" size="sm" onClick={() => {
              setCorrectOpen(false);
              setCorrType(detail?.card_types?.id || detail?.card_type_id || '');
              setCorrAmount(detail?.amount_foreign != null ? String(detail.amount_foreign) : '');
              setCorrNote('');
            }}>Reset</Button>
          </div>

          <SectionLabel>Card type</SectionLabel>
          <Select value={corrType} onChange={(e) => setCorrType(e.target.value)}>
            {types.length === 0 && <option value={corrType}>Current type</option>}
            {types.map((t) => (
              <option key={t.id} value={t.id}>{t.name} ({t.country_code})</option>
            ))}
          </Select>

          <div style={{ marginTop: 12 }}>
            <SectionLabel>Foreign amount</SectionLabel>
            <Input
              type="number"
              inputMode="decimal"
              value={corrAmount}
              onChange={(e) => setCorrAmount(e.target.value)}
              mono
            />
          </div>

          <div style={{ marginTop: 12 }}>
            <SectionLabel>Note to user (required)</SectionLabel>
            <div>
              {CORRECTION_NOTES.map((n) => (
                <label key={n} style={{ display: 'flex', alignItems: 'flex-start', gap: 8, fontSize: 'var(--text-md)', color: 'var(--fg-primary)', padding: '4px 0', cursor: 'pointer', lineHeight: 1.4 }}>
                  <input type="radio" name="corrnote" checked={corrNote === n} onChange={() => setCorrNote(n)} style={{ marginTop: 4 }} />
                  <span>{n}</span>
                </label>
              ))}
            </div>
            <Textarea
              value={CORRECTION_NOTES.includes(corrNote) ? '' : corrNote}
              onChange={(e) => setCorrNote(e.target.value)}
              placeholder="Or enter a custom note"
              rows={2}
              style={{ marginTop: 8 }}
            />
          </div>

          <div style={{
            marginTop: 14, padding: 12, borderRadius: 'var(--radius-md)',
            background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)',
          }}>
            <DetailRow label="Rate" value={matchDenom ? `${Number(matchDenom.rate_naira)} / unit` : 'No matching denomination'} />
            <DetailRow label="Denomination" value={matchDenom?.range_label} />
            <DetailRow label="Payout" value={newPayout != null ? formatNaira(newPayout) : formatNaira(detail.payout_naira)} bold />
            {coupon > 0 && <DetailRow label="Coupon bonus" value={formatNaira(coupon)} />}
            <DetailRow label="Total credit" value={formatNaira(finalCredit)} bold />
          </div>
        </div>
      )}
    </Modal>
  );
}
