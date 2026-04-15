'use client';

import { useEffect, useState } from 'react';
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

export default function CouponsPage() {
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

  const isExpired = (d: string | null) => !!(d && new Date(d) < new Date(new Date().toDateString()));

  const statusBadge = (c: Coupon) => {
    if (!c.is_active) return { text: 'Disabled', style: styles.badgeDisabled };
    if (isExpired(c.expiry_date)) return { text: 'Expired', style: styles.badgeExpired };
    return { text: 'Active', style: styles.badgeActive };
  };

  return (
    <div style={styles.page}>
      <div style={{ ...styles.headerRow, gap: 8 }}>
        <TermsOfUseManager onChange={setTerms} />
        <button style={styles.createBtn} onClick={openCreate}>+ Create Coupon</button>
      </div>

      {showForm && (
        <div style={styles.card}>
          <p style={styles.cardTitle}>{form.id ? 'Edit Coupon' : 'Create Coupon'}</p>

          <div style={styles.fieldRow}>
            <div style={{ flex: 1 }}>
              <label style={styles.fieldLabel}>CODE</label>
              <input
                style={styles.input}
                value={form.code}
                onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })}
                placeholder="WELCOME10"
              />
            </div>
            <div style={{ flex: 1 }}>
              <label style={styles.fieldLabel}>MIN TRADE ($)</label>
              <input
                style={styles.input}
                type="number"
                value={form.min_trade_amount_usd}
                onChange={(e) => setForm({ ...form, min_trade_amount_usd: e.target.value })}
              />
            </div>
          </div>

          <div style={styles.fieldRow}>
            <div style={{ flex: 1 }}>
              <label style={styles.fieldLabel}>EXPIRY DATE</label>
              <input
                style={styles.input}
                type="date"
                value={form.expiry_date}
                onChange={(e) => setForm({ ...form, expiry_date: e.target.value })}
              />
            </div>
            <div style={{ flex: 1 }}>
              <label style={styles.fieldLabel}>TYPE OF CARD</label>
              <select
                style={styles.input}
                value={form.type}
                onChange={(e) => setForm({ ...form, type: e.target.value })}
              >
                {!form.type && <option value="">Select card</option>}
                {cards.map((c) => (
                  <option key={c.id} value={c.name}>{c.name}</option>
                ))}
              </select>
            </div>
          </div>

          <div style={styles.fieldRow}>
            <div style={{ flex: 1 }}>
              <label style={styles.fieldLabel}>TERMS OF USE</label>
              <select
                style={styles.input}
                value={form.terms_of_use}
                onChange={(e) => setForm({ ...form, terms_of_use: e.target.value })}
              >
                <option value="">— None —</option>
                {terms.map((t) => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </select>
            </div>
            <div style={{ flex: 1 }} />
          </div>

          <div style={styles.fieldRow}>
            <div style={{ flex: 1 }}>
              <label style={styles.fieldLabel}>BONUS (₦ flat)</label>
              <input
                style={styles.input}
                type="number"
                value={form.bonus_rate_naira}
                onChange={(e) => setForm({ ...form, bonus_rate_naira: e.target.value })}
              />
            </div>
            <div style={{ flex: 1, display: 'flex', alignItems: 'flex-end', gap: 10 }}>
              <div
                style={{ ...styles.toggle, backgroundColor: form.is_active ? '#111111' : '#E0E0E0' }}
                onClick={() => setForm({ ...form, is_active: !form.is_active })}
              >
                <div style={{ ...styles.toggleThumb, left: form.is_active ? 22 : 2 }} />
              </div>
              <span style={styles.toggleLabel}>{form.is_active ? 'Active' : 'Disabled'}</span>
            </div>
          </div>

          <div style={{ marginBottom: 14, backgroundColor: '#FAFAFA', borderRadius: 8, padding: 10, border: '1px solid #EEEEEE' }}>
            <label style={styles.fieldLabel}>ELIGIBILITY (OPTIONAL)</label>
            <p style={{ fontSize: 11, color: '#888', margin: '2px 0 8px' }}>Restrict to users who have traded a specific card. Leave blank for no restriction.</p>
            <select
              style={styles.input}
              value={form.restrict_card}
              onChange={(e) => setForm({ ...form, restrict_card: e.target.value })}
            >
              <option value="">No restriction (anyone eligible)</option>
              {cards.map((c) => (
                <option key={c.id} value={c.name}>Has traded {c.name}</option>
              ))}
            </select>
          </div>

          <div style={styles.formActions}>
            <button style={styles.cancelBtn} onClick={() => setShowForm(false)}>Cancel</button>
            <button style={{ ...styles.saveBtn, opacity: saving ? 0.7 : 1 }} disabled={saving} onClick={handleSave}>
              {saving ? 'Saving...' : 'Save Coupon'}
            </button>
          </div>
        </div>
      )}

      <div style={styles.section}>
        <p style={styles.sectionTitle}>All Coupons</p>
        {loading ? (
          <p style={styles.empty}>Loading...</p>
        ) : coupons.length === 0 ? (
          <p style={styles.empty}>No coupons yet.</p>
        ) : (
          <div style={styles.tableWrap}>
            <table style={styles.table}>
              <thead>
                <tr>
                  <th style={styles.th}>Code</th>
                  <th style={styles.th}>Min</th>
                  <th style={styles.th}>Type</th>
                  <th style={styles.th}>Reward</th>
                  <th style={styles.th}>Expiry</th>
                  <th style={styles.th}>Uses</th>
                  <th style={styles.th}>Status</th>
                  <th style={styles.th}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {coupons.map((c) => {
                  const b = statusBadge(c);
                  return (
                    <tr key={c.id}>
                      <td style={{ ...styles.td, fontWeight: 700 }}>{c.code}</td>
                      <td style={styles.td}>${Number(c.min_trade_amount_usd || 0).toLocaleString()}</td>
                      <td style={styles.td}>
                        <span style={styles.typeGift}>{c.type || '—'}</span>
                      </td>
                      <td style={styles.td}>₦{Number(c.bonus_rate_naira || 0).toLocaleString()}</td>
                      <td style={styles.td}>{c.expiry_date ? new Date(c.expiry_date).toLocaleDateString() : '—'}</td>
                      <td style={styles.td}>{c.use_count || 0}</td>
                      <td style={styles.td}><span style={b.style}>{b.text}</span></td>
                      <td style={styles.td}>
                        <button style={styles.btnEdit} onClick={() => openEdit(c)}>Edit</button>
                        <button style={styles.btnReject} onClick={() => toggleActive(c)}>
                          {c.is_active ? 'Disable' : 'Enable'}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {toast && <div style={styles.toast}>{toast}</div>}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  page: { paddingBottom: 40 },
  empty: { fontSize: 12, color: '#888888', padding: 20, textAlign: 'center' },

  headerRow: { display: 'flex', justifyContent: 'flex-end', marginBottom: 12 },
  createBtn: { backgroundColor: '#111111', color: '#FFFFFF', border: 'none', borderRadius: 100, padding: '10px 20px', fontSize: 13, fontWeight: 700, cursor: 'pointer' },

  card: { backgroundColor: '#FFFFFF', borderRadius: 10, padding: 16, marginBottom: 16 },
  cardTitle: { fontSize: 13, fontWeight: 700, color: '#111111', margin: '0 0 12px' },
  fieldRow: { display: 'flex', gap: 12, marginBottom: 12 },
  fieldLabel: { display: 'block', fontSize: 11, fontWeight: 600, color: '#888888', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 4 },
  input: { width: '100%', border: '1.5px solid #E8E8E8', borderRadius: 8, padding: '10px 14px', fontSize: 13, color: '#111111', outline: 'none', boxSizing: 'border-box', backgroundColor: '#FFFFFF' },

  toggle: { width: 44, height: 24, borderRadius: 100, position: 'relative', cursor: 'pointer', transition: 'background-color 0.25s', flexShrink: 0 },
  toggleThumb: { position: 'absolute', top: 2, width: 20, height: 20, borderRadius: '50%', backgroundColor: '#FFFFFF', boxShadow: '0 1px 3px rgba(0,0,0,0.2)', transition: 'left 0.25s' },
  toggleLabel: { fontSize: 12, fontWeight: 600, color: '#111111' },

  formActions: { display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 8 },
  cancelBtn: { backgroundColor: '#FFFFFF', color: '#111111', border: '1.5px solid #E8E8E8', borderRadius: 100, padding: '8px 20px', fontSize: 12, fontWeight: 700, cursor: 'pointer' },
  saveBtn: { backgroundColor: '#111111', color: '#FFFFFF', border: 'none', borderRadius: 100, padding: '8px 20px', fontSize: 12, fontWeight: 700, cursor: 'pointer' },

  section: { backgroundColor: '#FFFFFF', borderRadius: 10, padding: 16 },
  sectionTitle: { fontSize: 13, fontWeight: 700, color: '#111111', margin: '0 0 12px' },
  tableWrap: { overflowX: 'auto' },
  table: { width: '100%', borderCollapse: 'collapse', fontSize: 12 },
  th: { backgroundColor: '#111111', color: '#FFFFFF', textAlign: 'left', padding: '8px 10px', fontWeight: 600, fontSize: 11 },
  td: { padding: '8px 10px', borderBottom: '1px solid #EEEEEE', color: '#333333' },

  typeGift: { backgroundColor: '#E3F2FD', color: '#1565C0', padding: '2px 8px', borderRadius: 10, fontSize: 10, fontWeight: 600 },
  typeGen: { backgroundColor: '#F3E5F5', color: '#6A1B9A', padding: '2px 8px', borderRadius: 10, fontSize: 10, fontWeight: 600 },

  badgeActive: { backgroundColor: '#E8F5E9', color: '#2E7D32', padding: '2px 8px', borderRadius: 10, fontSize: 10, fontWeight: 600 },
  badgeDisabled: { backgroundColor: '#EBEBEB', color: '#666', padding: '2px 8px', borderRadius: 10, fontSize: 10, fontWeight: 600 },
  badgeExpired: { backgroundColor: '#FFEBEE', color: '#C62828', padding: '2px 8px', borderRadius: 10, fontSize: 10, fontWeight: 600 },

  btnEdit: { backgroundColor: '#111111', color: '#FFFFFF', border: 'none', borderRadius: 100, padding: '4px 12px', fontSize: 11, fontWeight: 600, cursor: 'pointer', marginRight: 6 },
  btnReject: { backgroundColor: '#FFFFFF', color: '#111111', border: '1.5px solid #E8E8E8', borderRadius: 100, padding: '4px 12px', fontSize: 11, fontWeight: 600, cursor: 'pointer' },

  toast: { position: 'fixed', bottom: 24, right: 24, backgroundColor: '#111111', color: '#FFFFFF', padding: '10px 20px', borderRadius: 8, fontSize: 13, fontWeight: 600, zIndex: 51 },
};
