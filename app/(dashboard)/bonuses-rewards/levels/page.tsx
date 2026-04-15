'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';

interface Tier {
  id: string;
  tier_order: number;
  name: string;
  target_usd: number;
  bonus_naira: number;
  badge_url: string | null;
  is_active: boolean;
  claims: number;
}

interface EditState {
  [id: string]: Partial<Tier>;
}

export default function LevelsPage() {
  const [tiers, setTiers] = useState<Tier[]>([]);
  const [edits, setEdits] = useState<EditState>({});
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [uploadingId, setUploadingId] = useState<string | null>(null);
  const [toast, setToast] = useState('');
  const fileInputs = useRef<Record<string, HTMLInputElement | null>>({});

  useEffect(() => { fetchTiers(); }, []);

  const fetchTiers = async (silent = false) => {
    if (!silent) setLoading(true);
    const res = await fetch('/api/levels');
    const data = await res.json();
    setTiers(data.tiers || []);
    setEdits({});
    if (!silent) setLoading(false);
  };

  const showToast = (msg: string) => { setToast(msg); setTimeout(() => setToast(''), 3000); };

  const getValue = <K extends keyof Tier>(t: Tier, field: K): Tier[K] => {
    const edit = edits[t.id];
    return (edit && field in edit ? (edit as any)[field] : t[field]) as Tier[K];
  };

  const setField = (id: string, field: keyof Tier, value: any) => {
    setEdits((e) => ({ ...e, [id]: { ...(e[id] || {}), [field]: value } }));
  };

  const hasEdits = (id: string) => !!edits[id] && Object.keys(edits[id]).length > 0;

  const saveTier = async (t: Tier) => {
    const patch = edits[t.id];
    if (!patch) return;
    setSavingId(t.id);
    const res = await fetch('/api/levels', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: t.id, ...patch }),
    });
    setSavingId(null);
    if (res.ok) { showToast(`${t.name} saved ✓`); fetchTiers(true); }
    else { const err = await res.json().catch(() => ({})); showToast(err.error || 'Failed to save tier.'); }
  };

  const onFilePick = async (t: Tier, file: File) => {
    setUploadingId(t.id);
    const fd = new FormData();
    fd.append('file', file);
    fd.append('tier_order', String(t.tier_order));
    const upRes = await fetch('/api/levels/upload', { method: 'POST', body: fd });
    if (!upRes.ok) { setUploadingId(null); const err = await upRes.json().catch(() => ({})); showToast(err.error || 'Upload failed.'); return; }
    const { url } = await upRes.json();

    // Persist the new URL directly to the tier
    const patchRes = await fetch('/api/levels', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: t.id, badge_url: url }),
    });
    setUploadingId(null);
    if (patchRes.ok) { showToast(`${t.name} badge updated ✓`); fetchTiers(true); }
    else showToast('Failed to save badge URL.');
  };

  return (
    <div style={styles.page}>
      <Link href="/bonuses-rewards" style={styles.breadcrumb}>← Back to Bonuses & Rewards</Link>

      <p style={styles.header}>Configure the six level tiers. Users advance sequentially — Newbie → Legend. Each tier has a trade target (USD) and a reward (₦). Badges are uploaded per tier to the <code>level-badges</code> bucket.</p>

      {loading ? (
        <p style={styles.empty}>Loading...</p>
      ) : (
        <div style={styles.grid}>
          {tiers.map((t) => {
            const name = getValue(t, 'name') as string;
            const target = getValue(t, 'target_usd') as number;
            const bonus = getValue(t, 'bonus_naira') as number;
            const active = getValue(t, 'is_active') as boolean;
            const badgeUrl = t.badge_url;
            const dirty = hasEdits(t.id);

            return (
              <div key={t.id} style={styles.card}>
                <div style={styles.cardHead}>
                  <span style={styles.tierOrder}>TIER {t.tier_order}</span>
                  <div
                    style={{ ...styles.toggle, backgroundColor: active ? '#111111' : '#E0E0E0' }}
                    onClick={() => setField(t.id, 'is_active', !active)}
                  >
                    <div style={{ ...styles.toggleThumb, left: active ? 22 : 2 }} />
                  </div>
                </div>

                <div style={styles.badgeRow}>
                  <div style={styles.badgePreview}>
                    {badgeUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={badgeUrl} alt={t.name} style={styles.badgeImg} />
                    ) : (
                      <span style={styles.badgePlaceholder}>No badge</span>
                    )}
                  </div>
                  <div style={{ flex: 1 }}>
                    <input
                      ref={(el) => { fileInputs.current[t.id] = el; }}
                      type="file"
                      accept="image/svg+xml,image/png,image/jpeg,image/webp"
                      style={{ display: 'none' }}
                      onChange={(e) => { const f = e.target.files?.[0]; if (f) onFilePick(t, f); e.target.value = ''; }}
                    />
                    <button
                      style={{ ...styles.uploadBtn, opacity: uploadingId === t.id ? 0.7 : 1 }}
                      disabled={uploadingId === t.id}
                      onClick={() => fileInputs.current[t.id]?.click()}
                    >
                      {uploadingId === t.id ? 'Uploading...' : badgeUrl ? 'Replace Badge' : 'Upload Badge'}
                    </button>
                    <p style={styles.uploadHint}>SVG, PNG, JPG, or WebP</p>
                  </div>
                </div>

                <label style={styles.fieldLabel}>NAME</label>
                <input
                  style={styles.input}
                  value={name}
                  onChange={(e) => setField(t.id, 'name', e.target.value)}
                />

                <div style={styles.fieldRow}>
                  <div style={{ flex: 1 }}>
                    <label style={styles.fieldLabel}>TARGET ($)</label>
                    <input
                      style={styles.input}
                      type="number"
                      value={String(target ?? '')}
                      onChange={(e) => setField(t.id, 'target_usd', Number(e.target.value))}
                    />
                  </div>
                  <div style={{ flex: 1 }}>
                    <label style={styles.fieldLabel}>BONUS (₦)</label>
                    <input
                      style={styles.input}
                      type="number"
                      value={String(bonus ?? '')}
                      onChange={(e) => setField(t.id, 'bonus_naira', Number(e.target.value))}
                    />
                  </div>
                </div>

                <div style={styles.statsLine}>
                  <span style={styles.stat}>Claims: <b>{t.claims}</b></span>
                  <span style={active ? styles.badgeActive : styles.badgeInactive}>{active ? 'Active' : 'Inactive'}</span>
                </div>

                <button
                  style={{ ...styles.saveBtn, opacity: dirty && savingId !== t.id ? 1 : 0.5 }}
                  disabled={!dirty || savingId === t.id}
                  onClick={() => saveTier(t)}
                >
                  {savingId === t.id ? 'Saving...' : dirty ? 'Save Tier' : 'No Changes'}
                </button>
              </div>
            );
          })}
        </div>
      )}

      {toast && <div style={styles.toast}>{toast}</div>}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  page: { paddingBottom: 40 },
  breadcrumb: { display: 'inline-block', fontSize: 12, color: '#555555', textDecoration: 'none', marginBottom: 12 },
  header: { fontSize: 12, color: '#555555', marginBottom: 16, lineHeight: 1.6 },
  empty: { fontSize: 12, color: '#888888', padding: 20, textAlign: 'center' },

  grid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 16 },
  card: { backgroundColor: '#FFFFFF', borderRadius: 12, padding: 16, display: 'flex', flexDirection: 'column', gap: 10 },
  cardHead: { display: 'flex', alignItems: 'center', justifyContent: 'space-between' },
  tierOrder: { fontSize: 11, fontWeight: 700, color: '#888888', letterSpacing: '0.08em' },

  toggle: { width: 44, height: 24, borderRadius: 100, position: 'relative', cursor: 'pointer', transition: 'background-color 0.25s', flexShrink: 0 },
  toggleThumb: { position: 'absolute', top: 2, width: 20, height: 20, borderRadius: '50%', backgroundColor: '#FFFFFF', boxShadow: '0 1px 3px rgba(0,0,0,0.2)', transition: 'left 0.25s' },

  badgeRow: { display: 'flex', gap: 12, alignItems: 'center' },
  badgePreview: { width: 72, height: 72, borderRadius: 12, backgroundColor: '#F7F7F7', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, overflow: 'hidden' },
  badgeImg: { width: '100%', height: '100%', objectFit: 'contain' },
  badgePlaceholder: { fontSize: 10, color: '#AAAAAA' },
  uploadBtn: { backgroundColor: '#111111', color: '#FFFFFF', border: 'none', borderRadius: 100, padding: '8px 16px', fontSize: 12, fontWeight: 700, cursor: 'pointer' },
  uploadHint: { fontSize: 10, color: '#AAAAAA', marginTop: 6, marginBottom: 0 },

  fieldLabel: { display: 'block', fontSize: 11, fontWeight: 600, color: '#888888', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 4, marginTop: 2 },
  fieldRow: { display: 'flex', gap: 10 },
  input: { width: '100%', border: '1.5px solid #E8E8E8', borderRadius: 8, padding: '9px 12px', fontSize: 13, color: '#111111', outline: 'none', boxSizing: 'border-box', backgroundColor: '#FFFFFF' },

  statsLine: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 4 },
  stat: { fontSize: 11, color: '#555555' },
  badgeActive: { backgroundColor: '#E8F5E9', color: '#2E7D32', padding: '2px 8px', borderRadius: 10, fontSize: 10, fontWeight: 600 },
  badgeInactive: { backgroundColor: '#EBEBEB', color: '#666', padding: '2px 8px', borderRadius: 10, fontSize: 10, fontWeight: 600 },

  saveBtn: { backgroundColor: '#111111', color: '#FFFFFF', border: 'none', borderRadius: 100, padding: '9px 16px', fontSize: 12, fontWeight: 700, cursor: 'pointer', marginTop: 6 },

  toast: { position: 'fixed', bottom: 24, right: 24, backgroundColor: '#111111', color: '#FFFFFF', padding: '10px 20px', borderRadius: 8, fontSize: 13, fontWeight: 600, zIndex: 51 },
};
