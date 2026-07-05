'use client';

import { useEffect, useState } from 'react';
import {
  PageHeader, Card, CardHeader, CardBody, CardFooter,
  Table, THead, TBody, Tr, Th, Td, TableEmpty,
  Button, Input, Select, FieldShell, Toggle,
} from '../../_ui';
import { useIsMobile } from '../../lib/useIsMobile';
import { formatNaira, StatusDot, type Tone } from '../_shared/statusUi';
import { TermsOfUseManager } from './TermsOfUseManager';

interface Rule { type: string; value: any }

interface Coupon {
  id: string;
  code: string;
  min_trade_amount_usd: number;
  expiry_date: string | null;
  type: string;
  bonus_rate_naira: number;
  is_active: boolean;
  use_count: number;
  created_at: string;
  eligibility_rules?: Rule[];
  terms_of_use?: string | null;
}

interface CardOpt { id: string; name: string }

interface FormState {
  id?: string;
  code: string;
  min_trade_amount_usd: string;
  expiry_date: string;
  type: string;
  bonus_rate_naira: string;
  is_active: boolean;
  restrict_card: string;
  terms_of_use: string;
}

const emptyForm: FormState = {
  code: '',
  min_trade_amount_usd: '',
  expiry_date: '',
  type: '',
  bonus_rate_naira: '',
  is_active: true,
  restrict_card: '',
  terms_of_use: '',
};

const isExpired = (d: string | null) => !!(d && new Date(d) < new Date(new Date().toDateString()));

function couponStatus(c: Coupon): { text: string; tone: Tone } {
  if (!c.is_active) return { text: 'Disabled', tone: 'neutral' };
  if (isExpired(c.expiry_date)) return { text: 'Expired', tone: 'danger' };
  return { text: 'Active', tone: 'success' };
}

function CouponsMobile({
  coupons, openEdit, toggleActive,
}: {
  coupons: Coupon[];
  openEdit: (c: Coupon) => void;
  toggleActive: (c: Coupon) => void;
}) {
  if (coupons.length === 0) {
    return (
      <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-default)', borderRadius: 'var(--radius-xl)', padding: '48px 20px', textAlign: 'center', color: 'var(--fg-tertiary)', fontSize: 'var(--text-md)' }}>
        No coupons yet.
      </div>
    );
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {coupons.map((c) => {
        const st = couponStatus(c);
        return (
          <div key={c.id} style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-default)', borderRadius: 'var(--radius-xl)', padding: 14 }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10 }}>
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xl)', fontWeight: 700, letterSpacing: '-0.01em' }}>
                {c.code}
              </div>
              <StatusDot status={st.text} tone={st.tone} />
            </div>
            <div style={{ fontSize: 'var(--text-md)', fontWeight: 600, marginTop: 4, color: 'var(--fg-primary)' }}>
              {c.type || '—'} <span style={{ color: 'var(--fg-tertiary)' }}>·</span> {formatNaira(c.bonus_rate_naira || 0)}
            </div>
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)', color: 'var(--fg-tertiary)', marginTop: 8 }}>
              min ${Number(c.min_trade_amount_usd || 0).toLocaleString()} · {c.use_count || 0} uses · expiry {c.expiry_date ? new Date(c.expiry_date).toLocaleDateString() : '—'}
            </div>
            <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
              <Button variant="secondary" size="sm" onClick={() => openEdit(c)}>Edit</Button>
              <Button variant="secondary" size="sm" onClick={() => toggleActive(c)}>
                {c.is_active ? 'Disable' : 'Enable'}
              </Button>
            </div>
          </div>
        );
      })}
    </div>
  );
}

export default function CouponsPage() {
  const isMobile = useIsMobile();
  const [coupons, setCoupons] = useState<Coupon[]>([]);
  const [cards, setCards] = useState<CardOpt[]>([]);
  const [terms, setTerms] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState('');

  useEffect(() => { fetchCoupons(); fetchCards(); }, []);

  const fetchCards = async () => {
    const res = await fetch('/api/cards');
    const data = await res.json().catch(() => ({}));
    const list: CardOpt[] = (data.cards || []).map((c: any) => ({ id: c.id, name: c.name }));
    setCards(list);
    setForm((f) => (f.type ? f : { ...f, type: list[0]?.name || '' }));
  };

  const fetchCoupons = async (silent = false) => {
    if (!silent) setLoading(true);
    const res = await fetch('/api/coupons');
    const data = await res.json();
    setCoupons(data.coupons || []);
    if (!silent) setLoading(false);
  };

  const showToast = (msg: string) => { setToast(msg); setTimeout(() => setToast(''), 3000); };

  const openCreate = () => { setForm({ ...emptyForm, type: cards[0]?.name || '' }); setShowForm(true); };
  const openEdit = (c: Coupon) => {
    const restrict = Array.isArray(c.eligibility_rules)
      ? (c.eligibility_rules.find((r) => r.type === 'specific_card_category')?.value ?? '')
      : '';
    setForm({
      id: c.id,
      code: c.code,
      min_trade_amount_usd: String(c.min_trade_amount_usd ?? ''),
      expiry_date: c.expiry_date ? c.expiry_date.slice(0, 10) : '',
      type: c.type,
      bonus_rate_naira: String(c.bonus_rate_naira ?? ''),
      is_active: c.is_active,
      restrict_card: typeof restrict === 'string' ? restrict : '',
      terms_of_use: c.terms_of_use || '',
    });
    setShowForm(true);
  };

  const handleSave = async () => {
    if (!form.code.trim()) { showToast('Code is required.'); return; }
    if (!form.type) { showToast('Card type is required.'); return; }
    setSaving(true);
    const eligibility_rules: Rule[] = form.restrict_card
      ? [{ type: 'specific_card_category', value: form.restrict_card }]
      : [];
    const payload = {
      code: form.code.trim(),
      min_trade_amount_usd: Number(form.min_trade_amount_usd) || 0,
      expiry_date: form.expiry_date || null,
      type: form.type,
      bonus_rate_naira: Number(form.bonus_rate_naira) || 0,
      is_active: form.is_active,
      eligibility_rules,
      terms_of_use: form.terms_of_use || null,
    };
    const res = form.id
      ? await fetch('/api/coupons', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: form.id, ...payload }),
        })
      : await fetch('/api/coupons', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
    setSaving(false);
    if (res.ok) {
      showToast(form.id ? 'Coupon updated ✓' : 'Coupon created ✓');
      setShowForm(false);
      fetchCoupons(true);
    } else {
      const err = await res.json().catch(() => ({}));
      showToast(err.error || 'Failed to save coupon.');
    }
  };

  const toggleActive = async (c: Coupon) => {
    const res = await fetch('/api/coupons', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: c.id, is_active: !c.is_active }),
    });
    if (res.ok) { showToast(c.is_active ? 'Coupon disabled' : 'Coupon enabled'); fetchCoupons(true); }
    else showToast('Failed to update coupon.');
  };

  return (
    <div>
      <PageHeader
        title="Coupons"
        subtitle="Create promo codes, set eligibility and rewards, and manage their lifecycle."
        actions={
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <TermsOfUseManager onChange={setTerms} />
            <Button variant="primary" size="sm" onClick={openCreate}>+ Create Coupon</Button>
          </div>
        }
      />

      {showForm && (
        <Card style={{ marginBottom: 'var(--space-4)' }}>
          <CardHeader title={form.id ? 'Edit Coupon' : 'Create Coupon'} />
          <CardBody>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 12, marginBottom: 12 }}>
              <FieldShell label="Code">
                <Input
                  value={form.code}
                  onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })}
                  placeholder="WELCOME10"
                />
              </FieldShell>
              <FieldShell label="Min Trade ($)">
                <Input
                  type="number"
                  mono
                  value={form.min_trade_amount_usd}
                  onChange={(e) => setForm({ ...form, min_trade_amount_usd: e.target.value })}
                />
              </FieldShell>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 12, marginBottom: 12 }}>
              <FieldShell label="Expiry Date">
                <Input
                  type="date"
                  value={form.expiry_date}
                  onChange={(e) => setForm({ ...form, expiry_date: e.target.value })}
                />
              </FieldShell>
              <FieldShell label="Type of Card">
                <Select
                  value={form.type}
                  onChange={(e) => setForm({ ...form, type: e.target.value })}
                >
                  {!form.type && <option value="">Select card</option>}
                  {cards.map((c) => (
                    <option key={c.id} value={c.name}>{c.name}</option>
                  ))}
                </Select>
              </FieldShell>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 12, marginBottom: 12 }}>
              <FieldShell label="Terms of Use">
                <Select
                  value={form.terms_of_use}
                  onChange={(e) => setForm({ ...form, terms_of_use: e.target.value })}
                >
                  <option value="">— None —</option>
                  {terms.map((t) => (
                    <option key={t} value={t}>{t}</option>
                  ))}
                </Select>
              </FieldShell>
              <div />
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 12, marginBottom: 12, alignItems: 'end' }}>
              <FieldShell label="Bonus (₦ flat)">
                <Input
                  type="number"
                  mono
                  value={form.bonus_rate_naira}
                  onChange={(e) => setForm({ ...form, bonus_rate_naira: e.target.value })}
                />
              </FieldShell>
              <FieldShell label="Status">
                <Toggle
                  checked={form.is_active}
                  onChange={(v) => setForm({ ...form, is_active: v })}
                  label={form.is_active ? 'Active' : 'Disabled'}
                />
              </FieldShell>
            </div>

            <FieldShell
              label="Eligibility (optional)"
              help="Restrict to users who have traded a specific card. Leave blank for no restriction."
            >
              <Select
                value={form.restrict_card}
                onChange={(e) => setForm({ ...form, restrict_card: e.target.value })}
              >
                <option value="">No restriction (anyone eligible)</option>
                {cards.map((c) => (
                  <option key={c.id} value={c.name}>Has traded {c.name}</option>
                ))}
              </Select>
            </FieldShell>
          </CardBody>
          <CardFooter style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
            <Button variant="secondary" size="sm" onClick={() => setShowForm(false)}>Cancel</Button>
            <Button variant="primary" size="sm" loading={saving} disabled={saving} onClick={handleSave}>
              {saving ? 'Saving...' : 'Save Coupon'}
            </Button>
          </CardFooter>
        </Card>
      )}

      {loading ? (
        <Card>
          <CardBody>
            <p style={{ fontSize: 'var(--text-xs)', color: 'var(--fg-tertiary)', margin: 0 }}>Loading…</p>
          </CardBody>
        </Card>
      ) : isMobile ? (
        <CouponsMobile coupons={coupons} openEdit={openEdit} toggleActive={toggleActive} />
      ) : (
        <Card>
          <CardBody flush>
            <Table flush>
              <THead>
                <Tr>
                  <Th>Code</Th>
                  <Th align="right">Min</Th>
                  <Th>Type</Th>
                  <Th align="right">Reward</Th>
                  <Th>Expiry</Th>
                  <Th align="right">Uses</Th>
                  <Th>Status</Th>
                  <Th>Actions</Th>
                </Tr>
              </THead>
              <TBody>
                {coupons.length === 0 ? (
                  <TableEmpty colSpan={8}>No coupons yet.</TableEmpty>
                ) : coupons.map((c) => {
                  const st = couponStatus(c);
                  return (
                    <Tr key={c.id}>
                      <Td emphasis="primary" mono>{c.code}</Td>
                      <Td align="right" mono emphasis="secondary">${Number(c.min_trade_amount_usd || 0).toLocaleString()}</Td>
                      <Td emphasis="secondary">{c.type || '—'}</Td>
                      <Td align="right" mono emphasis="primary">{formatNaira(c.bonus_rate_naira || 0)}</Td>
                      <Td emphasis="secondary" mono>{c.expiry_date ? new Date(c.expiry_date).toLocaleDateString() : '—'}</Td>
                      <Td align="right" mono emphasis="secondary">{c.use_count || 0}</Td>
                      <Td><StatusDot status={st.text} tone={st.tone} /></Td>
                      <Td>
                        <div style={{ display: 'flex', gap: 6 }}>
                          <Button variant="secondary" size="sm" onClick={() => openEdit(c)}>Edit</Button>
                          <Button variant="secondary" size="sm" onClick={() => toggleActive(c)}>
                            {c.is_active ? 'Disable' : 'Enable'}
                          </Button>
                        </div>
                      </Td>
                    </Tr>
                  );
                })}
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
