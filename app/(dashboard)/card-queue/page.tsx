'use client';

import { useEffect, useState, useCallback } from 'react';

type Status = 'all' | 'pending' | 'approved' | 'rejected' | 'disputed';

const TABS: { key: Status; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'pending', label: 'Pending' },
  { key: 'approved', label: 'Approved' },
  { key: 'rejected', label: 'Rejected' },
  { key: 'disputed', label: 'Dispute Queue' },
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
  return 'N' + v.toLocaleString('en-NG', { minimumFractionDigits: 2 });
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { bg: string; color: string; label: string }> = {
    pending: { bg: '#FFF8E1', color: '#F9A825', label: 'Pending' },
    approved: { bg: '#E8F5E9', color: '#1B5E20', label: 'Approved' },
    rejected: { bg: '#FFEBEE', color: '#E53935', label: 'Rejected' },
    disputed: { bg: '#FFF8E1', color: '#F9A825', label: 'Disputed' },
    dispute_resolved: { bg: '#E8F5E9', color: '#1B5E20', label: 'Resolved' },
  };
  const s = map[status] || map.pending;
  return (
    <span style={{
      display: 'inline-block',
      backgroundColor: s.bg,
      color: s.color,
      padding: '3px 10px',
      borderRadius: 100,
      fontSize: 10,
      fontWeight: 700,
    }}>{s.label}</span>
  );
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

  // Approval correction state
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
      {/* Tabs + Search */}
      <div style={s.tabBar}>
        <div style={s.tabs}>
          {TABS.map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              style={{
                ...s.tabBtn,
                ...(tab === t.key ? s.tabBtnActive : {}),
              }}
            >{t.label}</button>
          ))}
        </div>
        <input
          placeholder="Search user or card brand"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={s.search}
        />
      </div>

      <div style={s.tableWrap}>
        <table style={s.table}>
          <thead>
            <tr>
              {['User', 'Card', 'Country', 'Type', 'Value', 'Payout', 'Submitted', 'Status', 'Actions'].map((c) => (
                <th key={c} style={s.th}>{c}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr><td colSpan={9} style={{ ...s.td, textAlign: 'center', color: '#888' }}>Loading…</td></tr>
            )}
            {!loading && rows.length === 0 && (
              <tr><td colSpan={9} style={{ ...s.td, textAlign: 'center', color: '#888' }}>No submissions</td></tr>
            )}
            {rows.map((r: any) => (
              <tr
                key={r.id}
                style={{ backgroundColor: r.status === 'pending' ? '#FFFDE7' : '#FFFFFF' }}
              >
                <td style={{ ...s.td, fontWeight: 600 }}>{r.users?.username || '-'}</td>
                <td style={s.td}>{r.cards?.name || '-'}</td>
                <td style={s.td}>{r.card_types?.country_code || '-'}</td>
                <td style={s.td}>{r.card_types?.name || '-'}</td>
                <td style={s.td}>{r.amount_foreign || '-'}</td>
                <td style={{ ...s.td, fontWeight: 700, color: '#2E7D32' }}>{formatNaira(r.payout_naira)}</td>
                <td style={s.td}>{new Date(r.created_at).toLocaleString()}</td>
                <td style={s.td}><StatusBadge status={r.status} /></td>
                <td style={s.td}>
                  <div style={s.actions}>
                    {r.status === 'pending' && (
                      <>
                        <button style={s.approveBtn} onClick={() => { openDetail(r.id); setShowApprove(true); }}>Approve</button>
                        <button style={s.rejectBtn} onClick={() => { openDetail(r.id); setShowReject(true); }}>Reject</button>
                      </>
                    )}
                    <button style={s.viewBtn} onClick={() => openDetail(r.id)}>View</button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Side panel */}
      {detail && (
        <>
          <div style={s.panelDim} onClick={closeDetail} />
          <div style={s.panel}>
            <div style={s.panelHead}>
              <p style={{ fontSize: 14, fontWeight: 700, margin: 0 }}>Card Submission</p>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', position: 'relative' }}>
                <button style={s.shareBtn} onClick={() => setShareOpen((v) => !v)} disabled={!detail.users}>Share</button>
                {shareOpen && (
                  <>
                    <div style={{ position: 'fixed', inset: 0, zIndex: 55 }} onClick={() => setShareOpen(false)} />
                    <div style={s.shareMenu}>
                      {detail.card_images && detail.card_images.length > 0 && (
                        <button style={s.shareItem} onClick={shareWithImages}>Share with images (native)</button>
                      )}
                      <button style={s.shareItem} onClick={shareToWhatsApp}>WhatsApp (text only)</button>
                      <button style={s.shareItem} onClick={shareToTelegram}>Telegram (text only)</button>
                      <button style={s.shareItem} onClick={shareToEmail}>Email (text only)</button>
                      <button style={s.shareItem} onClick={copyText}>Copy text</button>
                      {detail.card_images && detail.card_images.length > 0 && (
                        <button style={s.shareItem} onClick={downloadImages}>Download images</button>
                      )}
                    </div>
                  </>
                )}
                <button style={s.closeBtn} onClick={closeDetail}>×</button>
              </div>
            </div>
            {detailLoading || !detail.users ? (
              <p style={{ padding: 16, color: '#888' }}>Loading…</p>
            ) : (
              <div style={s.panelBody}>
                {/* User */}
                <div style={s.userRow}>
                  <div style={s.avatar}>{(detail.users.full_name || '?').charAt(0).toUpperCase()}</div>
                  <div>
                    <p style={{ fontSize: 14, fontWeight: 700, margin: 0 }}>{detail.users.full_name}</p>
                    <p style={{ fontSize: 12, color: '#888', margin: '2px 0 0' }}>{detail.users.email}</p>
                    <p style={{ fontSize: 12, color: '#888', margin: '2px 0 0' }}>@{detail.users.username}</p>
                  </div>
                </div>

                {/* Receipt */}
                <div style={{ marginTop: 16 }}>
                  <Row label="Card" value={detail.cards?.name} />
                  <Row label="Country" value={detail.country_name || detail.card_types?.country_code} />
                  <Row label="Type" value={detail.card_types?.name} />
                  <Row label="Denomination" value={detail.denominations?.range_label} />
                  <Row label="Value" value={detail.amount_foreign} />
                  <Row label="Rate" value={detail.rate_at_submission} />
                  <Row label="Payout" value={formatNaira(detail.payout_naira)} bold />
                  {detail.coupon_code && <Row label="Coupon" value={`${detail.coupon_code} (+${formatNaira(detail.coupon_bonus)})`} />}
                  <Row label="Submitted" value={new Date(detail.created_at).toLocaleString()} />
                  <Row label="Status" value={detail.status} />
                </div>

                {/* Submitted fields */}
                {detail.submitted_fields && Object.keys(detail.submitted_fields).length > 0 && (
                  <div style={{ marginTop: 16 }}>
                    <p style={s.sectionLabel}>Submitted Fields</p>
                    {Object.entries(detail.submitted_fields).map(([k, v]: [string, any]) => (
                      <Row key={k} label={k} value={String(v)} />
                    ))}
                  </div>
                )}

                {/* Card images */}
                {detail.card_images && detail.card_images.length > 0 && (
                  <div style={{ marginTop: 16 }}>
                    <p style={s.sectionLabel}>Card Images</p>
                    <div style={s.thumbs}>
                      {detail.card_images.map((url: string, i: number) => (
                        <img
                          key={i}
                          src={url}
                          style={s.thumb}
                          onClick={() => setLightbox({ images: detail.card_images, index: i })}
                          alt=""
                        />
                      ))}
                    </div>
                  </div>
                )}

                {/* Dispute */}
                {detail.status === 'disputed' && (
                  <div style={{ marginTop: 16 }}>
                    <div style={s.disputeBox}>
                      <p style={{ fontSize: 11, fontWeight: 700, color: '#F9A825', margin: 0, textTransform: 'uppercase' }}>Dispute Message</p>
                      <p style={{ fontSize: 13, margin: '6px 0 0', color: '#333' }}>{detail.dispute_message}</p>
                    </div>
                    {detail.dispute_images && detail.dispute_images.length > 0 && (
                      <div style={{ marginTop: 12 }}>
                        <p style={s.sectionLabel}>Dispute Evidence</p>
                        <div style={s.thumbs}>
                          {detail.dispute_images.map((url: string, i: number) => (
                            <img
                              key={i}
                              src={url}
                              style={s.thumb}
                              onClick={() => setLightbox({ images: detail.dispute_images, index: i })}
                              alt=""
                            />
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* Original rejection reason */}
                {detail.rejection_reason && detail.status !== 'pending' && (
                  <div style={{ marginTop: 16 }}>
                    <p style={s.sectionLabel}>Rejection Reason</p>
                    <p style={{ fontSize: 13, color: '#333', margin: 0 }}>{detail.rejection_reason}</p>
                  </div>
                )}

                {/* Action buttons */}
                <div style={{ marginTop: 24, display: 'flex', gap: 8 }}>
                  {detail.status === 'pending' && (
                    <>
                      <button style={s.actionApprove} onClick={() => setShowApprove(true)} disabled={busy}>Approve</button>
                      <button style={s.actionReject} onClick={() => setShowReject(true)} disabled={busy}>Reject</button>
                    </>
                  )}
                  {detail.status === 'disputed' && (
                    <>
                      <button style={s.actionApprove} onClick={() => setShowApprove(true)} disabled={busy}>Overturn (Approve + Credit)</button>
                      <button style={s.actionReject} onClick={() => doAction('uphold')} disabled={busy}>Uphold</button>
                    </>
                  )}
                </div>

                {/* Reject form */}
                {showReject && (
                  <div style={{ marginTop: 16, padding: 12, border: '1px solid #E8E8E8', borderRadius: 8 }}>
                    <p style={s.sectionLabel}>Rejection Reason</p>
                    {REJECT_REASONS.map((r) => (
                      <label key={r} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: '#333', padding: '4px 0' }}>
                        <input type="radio" name="rej" checked={rejectReason === r} onChange={() => { setRejectReason(r); setRejectCustom(''); }} />
                        {r}
                      </label>
                    ))}
                    <textarea
                      placeholder="Or enter a custom reason"
                      value={rejectCustom}
                      onChange={(e) => { setRejectCustom(e.target.value); setRejectReason(''); }}
                      style={{ width: '100%', marginTop: 8, padding: 8, border: '1.5px solid #E8E8E8', borderRadius: 8, fontSize: 13, minHeight: 60 }}
                    />
                    <button style={{ ...s.actionReject, marginTop: 8, width: '100%' }} disabled={busy} onClick={submitReject}>Confirm Reject</button>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Approve confirm modal */}
          {showApprove && detail.users && (() => {
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
              <div style={s.modalDim} onClick={() => setShowApprove(false)}>
                <div style={s.modal} onClick={(e) => e.stopPropagation()}>
                  <p style={{ fontSize: 14, fontWeight: 700, margin: 0 }}>Approve and credit</p>
                  <p style={{ fontSize: 13, margin: '8px 0 14px' }}>
                    Credit <strong>{formatNaira(finalCredit)}</strong> to <strong>@{detail.users.username}</strong>?
                  </p>

                  {!correctOpen ? (
                    <button
                      style={{ background: 'none', border: '1px dashed #BBB', color: '#555', borderRadius: 8, padding: '8px 12px', fontSize: 12, fontWeight: 600, cursor: 'pointer', width: '100%', marginBottom: 14 }}
                      onClick={() => setCorrectOpen(true)}
                    >+ Correct card type / amount</button>
                  ) : (
                    <div style={{ border: '1px solid #E8E8E8', borderRadius: 8, padding: 12, marginBottom: 14 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                        <p style={{ fontSize: 11, fontWeight: 700, color: '#888', textTransform: 'uppercase', margin: 0 }}>Correction</p>
                        <button
                          style={{ background: 'none', border: 'none', color: '#888', fontSize: 11, cursor: 'pointer' }}
                          onClick={() => {
                            setCorrectOpen(false);
                            setCorrType(detail?.card_types?.id || detail?.card_type_id || '');
                            setCorrAmount(detail?.amount_foreign != null ? String(detail.amount_foreign) : '');
                            setCorrNote('');
                          }}
                        >Reset</button>
                      </div>

                      <label style={{ fontSize: 11, fontWeight: 700, color: '#888', textTransform: 'uppercase' }}>Card Type</label>
                      <select
                        value={corrType}
                        onChange={(e) => setCorrType(e.target.value)}
                        style={{ width: '100%', padding: '10px 12px', border: '1.5px solid #E8E8E8', borderRadius: 8, fontSize: 13, marginTop: 4 }}
                      >
                        {types.length === 0 && <option value={corrType}>Current type</option>}
                        {types.map((t) => (
                          <option key={t.id} value={t.id}>{t.name} ({t.country_code})</option>
                        ))}
                      </select>

                      <label style={{ fontSize: 11, fontWeight: 700, color: '#888', textTransform: 'uppercase', marginTop: 12, display: 'block' }}>Foreign Amount</label>
                      <input
                        type="number"
                        inputMode="decimal"
                        value={corrAmount}
                        onChange={(e) => setCorrAmount(e.target.value)}
                        style={{ width: '100%', padding: '10px 12px', border: '1.5px solid #E8E8E8', borderRadius: 8, fontSize: 13, marginTop: 4 }}
                      />

                      <label style={{ fontSize: 11, fontWeight: 700, color: '#888', textTransform: 'uppercase', marginTop: 12, display: 'block' }}>Note to user (required)</label>
                      <div style={{ marginTop: 4 }}>
                        {CORRECTION_NOTES.map((n) => (
                          <label key={n} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: '#333', padding: '3px 0' }}>
                            <input
                              type="radio"
                              name="corrnote"
                              checked={corrNote === n}
                              onChange={() => setCorrNote(n)}
                            />
                            {n}
                          </label>
                        ))}
                      </div>
                      <textarea
                        value={CORRECTION_NOTES.includes(corrNote) ? '' : corrNote}
                        onChange={(e) => setCorrNote(e.target.value)}
                        placeholder="Or enter a custom note"
                        style={{ width: '100%', padding: '10px 12px', border: '1.5px solid #E8E8E8', borderRadius: 8, fontSize: 13, marginTop: 8, minHeight: 60, fontFamily: 'inherit' }}
                      />

                      <div style={{ marginTop: 14, padding: 12, borderRadius: 8, backgroundColor: '#F7F7F7' }}>
                        <Row label="Rate" value={matchDenom ? `${Number(matchDenom.rate_naira)} / unit` : 'No matching denomination'} />
                        <Row label="Denomination" value={matchDenom?.range_label} />
                        <Row label="Payout" value={newPayout != null ? formatNaira(newPayout) : formatNaira(detail.payout_naira)} bold />
                        {coupon > 0 && <Row label="Coupon bonus" value={formatNaira(coupon)} />}
                        <Row label="Total credit" value={formatNaira(finalCredit)} bold />
                      </div>
                    </div>
                  )}
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button style={{ ...s.actionApprove, flex: 1, opacity: canConfirm ? 1 : 0.5 }} disabled={busy || !canConfirm} onClick={() => doAction(detail.status === 'disputed' ? 'overturn' : 'approve')}>Confirm</button>
                    <button style={{ ...s.actionGrey, flex: 1 }} disabled={busy} onClick={() => setShowApprove(false)}>Cancel</button>
                  </div>
                </div>
              </div>
            );
          })()}
        </>
      )}

      {/* Lightbox */}
      {lightbox && (
        <div style={s.lightboxDim} onClick={() => setLightbox(null)}>
          <button style={s.lbClose} onClick={() => setLightbox(null)}>×</button>
          {lightbox.index > 0 && (
            <button style={{ ...s.lbArrow, left: 24 }} onClick={(e) => { e.stopPropagation(); setLightbox({ ...lightbox, index: lightbox.index - 1 }); }}>‹</button>
          )}
          <img src={lightbox.images[lightbox.index]} style={s.lbImg} onClick={(e) => e.stopPropagation()} alt="" />
          {lightbox.index < lightbox.images.length - 1 && (
            <button style={{ ...s.lbArrow, right: 24 }} onClick={(e) => { e.stopPropagation(); setLightbox({ ...lightbox, index: lightbox.index + 1 }); }}>›</button>
          )}
        </div>
      )}
    </div>
  );
}

function Row({ label, value, bold }: { label: string; value: any; bold?: boolean }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid #F0F0F0', fontSize: 13 }}>
      <span style={{ color: '#888' }}>{label}</span>
      <span style={{ fontWeight: bold ? 800 : 700, color: '#111', maxWidth: '55%', textAlign: 'right', wordBreak: 'break-word' }}>{value || '-'}</span>
    </div>
  );
}

const s: Record<string, React.CSSProperties> = {
  tabBar: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, gap: 12 },
  tabs: { display: 'flex', gap: 0, borderBottom: '1px solid #EEE' },
  tabBtn: { padding: '10px 16px', background: 'none', border: 'none', borderBottom: '2px solid transparent', fontSize: 12, fontWeight: 500, color: '#888', cursor: 'pointer' },
  tabBtnActive: { borderBottom: '2px solid #111111', color: '#111', fontWeight: 700 },
  search: { width: 280, border: '1.5px solid #E8E8E8', borderRadius: 8, padding: '10px 14px', fontSize: 13 },
  tableWrap: { overflowX: 'auto', borderRadius: 10, border: '1px solid #EEEEEE', backgroundColor: '#FFF' },
  table: { width: '100%', borderCollapse: 'collapse', fontSize: 12 },
  th: { backgroundColor: '#111111', color: '#FFFFFF', fontSize: 12, fontWeight: 700, padding: '10px 12px', textAlign: 'left', whiteSpace: 'nowrap' },
  td: { padding: '12px 12px', color: '#333', fontSize: 12, minHeight: 52, verticalAlign: 'middle' },
  actions: { display: 'flex', gap: 6 },
  approveBtn: { backgroundColor: '#E8F5E9', color: '#2E7D32', border: 'none', borderRadius: 6, padding: '4px 10px', fontSize: 11, fontWeight: 600, cursor: 'pointer' },
  rejectBtn: { backgroundColor: '#FFEBEE', color: '#C62828', border: 'none', borderRadius: 6, padding: '4px 10px', fontSize: 11, fontWeight: 600, cursor: 'pointer' },
  viewBtn: { backgroundColor: '#E3F2FD', color: '#1565C0', border: 'none', borderRadius: 6, padding: '4px 10px', fontSize: 11, fontWeight: 600, cursor: 'pointer' },
  panelDim: { position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.4)', zIndex: 49 },
  panel: { position: 'fixed', top: 0, right: 0, bottom: 0, width: 520, backgroundColor: '#FFF', zIndex: 50, display: 'flex', flexDirection: 'column', boxShadow: '-4px 0 20px rgba(0,0,0,0.1)' },
  panelHead: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: 16, borderBottom: '1px solid #EEE' },
  closeBtn: { background: '#F7F7F7', border: 'none', borderRadius: '50%', width: 30, height: 30, fontSize: 18, cursor: 'pointer' },
  shareBtn: { background: '#111111', color: '#FFFFFF', border: 'none', borderRadius: 100, padding: '7px 14px', fontSize: 12, fontWeight: 700, cursor: 'pointer' },
  shareMenu: { position: 'absolute', top: 38, right: 40, backgroundColor: '#FFF', border: '1px solid #E8E8E8', borderRadius: 10, boxShadow: '0 4px 16px rgba(0,0,0,0.1)', zIndex: 56, minWidth: 180, padding: 4 },
  shareItem: { display: 'block', width: '100%', textAlign: 'left', background: 'none', border: 'none', padding: '10px 14px', fontSize: 13, color: '#111', cursor: 'pointer', borderRadius: 6 },
  panelBody: { flex: 1, overflowY: 'auto', padding: 16 },
  userRow: { display: 'flex', gap: 12, alignItems: 'center' },
  avatar: { width: 36, height: 36, borderRadius: '50%', backgroundColor: '#111', color: '#FFF', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, fontWeight: 700 },
  sectionLabel: { fontSize: 11, fontWeight: 700, color: '#888', textTransform: 'uppercase', margin: '0 0 8px' },
  thumbs: { display: 'flex', flexWrap: 'wrap', gap: 8 },
  thumb: { width: 120, height: 100, borderRadius: 8, objectFit: 'cover', border: '1px solid #EEE', cursor: 'pointer' },
  disputeBox: { backgroundColor: '#FFF8E1', border: '1px solid #F9A825', borderRadius: 8, padding: 12 },
  actionApprove: { flex: 1, backgroundColor: '#E8F5E9', color: '#2E7D32', border: 'none', borderRadius: 8, padding: '12px 16px', fontSize: 13, fontWeight: 700, cursor: 'pointer' },
  actionReject: { flex: 1, backgroundColor: '#FFEBEE', color: '#C62828', border: 'none', borderRadius: 8, padding: '12px 16px', fontSize: 13, fontWeight: 700, cursor: 'pointer' },
  actionGrey: { backgroundColor: '#F0F0F0', color: '#333', border: 'none', borderRadius: 8, padding: '12px 16px', fontSize: 13, fontWeight: 700, cursor: 'pointer' },
  modalDim: { position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.5)', zIndex: 60, display: 'flex', alignItems: 'center', justifyContent: 'center' },
  modal: { backgroundColor: '#FFF', borderRadius: 12, padding: 20, width: 560, maxWidth: '92%', maxHeight: '90vh', overflowY: 'auto' },
  lightboxDim: { position: 'fixed', inset: 0, backgroundColor: '#000000EE', zIndex: 70, display: 'flex', alignItems: 'center', justifyContent: 'center' },
  lbImg: { maxWidth: '92%', maxHeight: '92%', objectFit: 'contain' },
  lbClose: { position: 'absolute', top: 24, right: 24, background: 'rgba(255,255,255,0.15)', border: 'none', color: '#FFF', width: 40, height: 40, borderRadius: '50%', fontSize: 22, cursor: 'pointer' },
  lbArrow: { position: 'absolute', top: '50%', transform: 'translateY(-50%)', background: 'rgba(255,255,255,0.15)', border: 'none', color: '#FFF', width: 44, height: 44, borderRadius: '50%', fontSize: 28, cursor: 'pointer' },
};
