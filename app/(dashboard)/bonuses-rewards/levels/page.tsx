'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import {
  PageHeader, Card, CardHeader, CardBody, CardFooter,
  FieldShell, Input, Toggle, Button,
} from '../../../_ui';
import { StatusDot } from '../../_shared/statusUi';

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
    <div>
      <Link
        href="/bonuses-rewards"
        style={{ display: 'inline-block', fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)', letterSpacing: '0.03em', color: 'var(--fg-tertiary)', textDecoration: 'none', marginBottom: 'var(--space-3)' }}
      >
        ← Back to Bonuses & Rewards
      </Link>

      <PageHeader
        title="Level Tiers"
        subtitle="Configure the six level tiers. Users advance sequentially — Newbie → Legend. Each tier has a trade target (USD) and a reward (₦); badges are uploaded per tier to the level-badges bucket."
      />

      {loading ? (
        <Card>
          <CardBody>
            <p style={{ fontSize: 'var(--text-xs)', color: 'var(--fg-tertiary)', margin: 0 }}>Loading…</p>
          </CardBody>
        </Card>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 'var(--space-4)' }}>
          {tiers.map((t) => {
            const name = getValue(t, 'name') as string;
            const target = getValue(t, 'target_usd') as number;
            const bonus = getValue(t, 'bonus_naira') as number;
            const active = getValue(t, 'is_active') as boolean;
            const badgeUrl = t.badge_url;
            const dirty = hasEdits(t.id);

            return (
              <Card key={t.id}>
                <CardHeader
                  title={`Tier ${t.tier_order}`}
                  actions={<Toggle checked={active} onChange={() => setField(t.id, 'is_active', !active)} />}
                />
                <CardBody>
                  <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 'var(--space-4)' }}>
                    <div style={{ width: 72, height: 72, borderRadius: 'var(--radius-lg)', background: 'var(--bg-subtle)', border: '1px solid var(--border-subtle)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, overflow: 'hidden' }}>
                      {badgeUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={badgeUrl} alt={t.name} style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
                      ) : (
                        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--fg-tertiary)' }}>No badge</span>
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
                      <Button
                        variant="secondary"
                        size="sm"
                        loading={uploadingId === t.id}
                        disabled={uploadingId === t.id}
                        onClick={() => fileInputs.current[t.id]?.click()}
                      >
                        {uploadingId === t.id ? 'Uploading…' : badgeUrl ? 'Replace Badge' : 'Upload Badge'}
                      </Button>
                      <p style={{ fontSize: 'var(--text-xs)', color: 'var(--fg-tertiary)', margin: '8px 0 0' }}>SVG, PNG, JPG, or WebP</p>
                    </div>
                  </div>

                  <FieldShell label="Name">
                    <Input value={name} onChange={(e) => setField(t.id, 'name', e.target.value)} />
                  </FieldShell>

                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 12, marginTop: 'var(--space-3)' }}>
                    <FieldShell label="Target ($)">
                      <Input
                        type="number"
                        mono
                        value={String(target ?? '')}
                        onChange={(e) => setField(t.id, 'target_usd', Number(e.target.value))}
                      />
                    </FieldShell>
                    <FieldShell label="Bonus (₦)">
                      <Input
                        type="number"
                        mono
                        value={String(bonus ?? '')}
                        onChange={(e) => setField(t.id, 'bonus_naira', Number(e.target.value))}
                      />
                    </FieldShell>
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 'var(--space-4)' }}>
                    <span style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)', color: 'var(--fg-tertiary)', letterSpacing: '0.03em' }}>
                      CLAIMS {t.claims.toLocaleString()}
                    </span>
                    <StatusDot status={active ? 'Active' : 'Inactive'} tone={active ? 'success' : 'neutral'} />
                  </div>
                </CardBody>
                <CardFooter style={{ display: 'flex', justifyContent: 'flex-end' }}>
                  <Button
                    variant="primary"
                    size="sm"
                    loading={savingId === t.id}
                    disabled={!dirty || savingId === t.id}
                    onClick={() => saveTier(t)}
                  >
                    {savingId === t.id ? 'Saving…' : dirty ? 'Save Tier' : 'No Changes'}
                  </Button>
                </CardFooter>
              </Card>
            );
          })}
        </div>
      )}

      {toast && (
        <div style={{ position: 'fixed', bottom: 24, right: 24, background: 'var(--fg-primary)', color: 'var(--bg-base)', padding: '10px 18px', borderRadius: 'var(--radius-lg)', fontSize: 'var(--text-sm)', fontWeight: 600, zIndex: 51 }}>
          {toast}
        </div>
      )}
    </div>
  );
}
