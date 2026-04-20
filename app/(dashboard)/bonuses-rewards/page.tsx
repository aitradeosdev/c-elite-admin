'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';

interface GiftboxItem {
  id: string;
  title: string;
  description: string | null;
  reward_naira: number;
  expiry_date: string | null;
  eligibility_condition: string | null;
  eligibility_rules: Rule[] | null;
  is_active: boolean;
  claims: number;
}

interface Rule { type: string; value: any }

const RULE_TYPES: Array<{ type: string; label: string; input: 'int' | 'number' | 'string' | 'none' | 'count_days' | 'amount_days' | 'csv' | 'amount_card' }> = [
  { type: 'min_trades', label: 'Min approved trades', input: 'int' },
  { type: 'min_volume_usd', label: 'Min lifetime volume ($)', input: 'number' },
  { type: 'min_single_trade_usd', label: 'Single trade ≥ $X (optional card)', input: 'amount_card' },
  { type: 'trades_in_period', label: 'Trades in last N days', input: 'count_days' },
  { type: 'volume_in_period', label: 'Volume ($) in last N days', input: 'amount_days' },
  { type: 'min_card_categories', label: 'Min distinct card categories', input: 'int' },
  { type: 'specific_card_category', label: 'Has traded specific card', input: 'string' },
  { type: 'min_avg_trade_usd', label: 'Min avg trade size ($)', input: 'number' },
  { type: 'min_level', label: 'Min level (1-6)', input: 'int' },
  { type: 'exact_level', label: 'Exact level (1-6)', input: 'int' },
  { type: 'has_claimed_level_bonus', label: 'Has claimed any level bonus', input: 'none' },
  { type: 'min_account_age_days', label: 'Min account age (days)', input: 'int' },
  { type: 'max_account_age_days', label: 'Max account age (days)', input: 'int' },
  { type: 'email_verified', label: 'Email verified', input: 'none' },
  { type: 'has_set_pin', label: 'Has set PIN', input: 'none' },
  { type: 'has_bank_account', label: 'Has saved bank account', input: 'none' },
  { type: 'country_in', label: 'Country in (comma list)', input: 'csv' },
  { type: 'min_referrals', label: 'Min referrals', input: 'int' },
  { type: 'min_successful_referrals', label: 'Min successful referrals', input: 'int' },
  { type: 'max_claims_per_user', label: 'Max claims per user', input: 'int' },
  { type: 'cooldown_days', label: 'Cooldown (days)', input: 'int' },
  { type: 'first_time_claimer', label: 'First-time giftbox claimer', input: 'none' },
  { type: 'min_balance_naira', label: 'Min wallet balance (₦)', input: 'number' },
  { type: 'min_withdrawn_total', label: 'Min lifetime withdrawals (₦)', input: 'number' },
  { type: 'has_used_coupon', label: 'Has used a coupon', input: 'none' },
  { type: 'completed_task', label: 'Completed N tasks', input: 'int' },
  { type: 'consecutive_days_active', label: 'Consecutive active days', input: 'int' },
];

interface Stats {
  level_claims_today: number;
  level_tier_count: number;
  signup_awarded_today: number;
  signup_awarded_total: number;
  anniversary_awarded_today: number;
}

const CONFIG_KEYS = [
  'levels_active',
  'signup_bonus_active', 'signup_bonus_amount', 'signup_bonus_condition',
  'anniversary_bonus_active', 'anniversary_bonus_amount',
];

export default function BonusesPage() {
  const [config, setConfig] = useState<Record<string, string>>({});
  const [pending, setPending] = useState<Record<string, string>>({});
  const [stats, setStats] = useState<Stats | null>(null);
  const [items, setItems] = useState<GiftboxItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState('');

  const [showItemModal, setShowItemModal] = useState(false);
  const [editItem, setEditItem] = useState<GiftboxItem | null>(null);
  const [iTitle, setITitle] = useState('');
  const [iDesc, setIDesc] = useState('');
  const [iReward, setIReward] = useState('');
  const [iExpiry, setIExpiry] = useState('');
  const [iCondition, setICondition] = useState('');
  const [iRules, setIRules] = useState<Rule[]>([]);
  const [iActive, setIActive] = useState(true);
  const [savingItem, setSavingItem] = useState(false);

  useEffect(() => { fetchAll(); }, []);

  const fetchAll = async (silent = false) => {
    if (!silent) setLoading(true);
    const [configRes, statsRes, giftboxRes] = await Promise.all([
      fetch(`/api/app-config?keys=${CONFIG_KEYS.join(',')}`),
      fetch('/api/bonuses'),
      fetch('/api/giftbox'),
    ]);
    const configData = await configRes.json();
    const statsData = await statsRes.json();
    const giftboxData = await giftboxRes.json();
    setConfig(configData.config || {});
    setStats(statsData.stats || null);
    setItems(giftboxData.items || []);
    if (!silent) setLoading(false);
  };

  const getValue = (key: string) => pending[key] ?? config[key] ?? '';
  const setValue = (key: string, value: string) => setPending((p) => ({ ...p, [key]: value }));
  const getToggle = (key: string) => getValue(key) === 'true';
  const toggleKey = (key: string) => setValue(key, getToggle(key) ? 'false' : 'true');

  const showToast = (msg: string) => { setToast(msg); setTimeout(() => setToast(''), 3000); };

  const handleSaveAll = async () => {
    if (Object.keys(pending).length === 0) { showToast('No changes to save.'); return; }
    setSaving(true);
    const res = await fetch('/api/app-config', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ changes: pending }),
    });
    setSaving(false);
    if (res.ok) { setPending({}); showToast('Bonus settings saved ✓'); fetchAll(true); }
    else showToast('Failed to save settings.');
  };

  const openAddItem = () => {
    setEditItem(null);
    setITitle(''); setIDesc(''); setIReward(''); setIExpiry(''); setICondition(''); setIRules([]); setIActive(true);
    setShowItemModal(true);
  };
  const openEditItem = (item: GiftboxItem) => {
    setEditItem(item);
    setITitle(item.title || '');
    setIDesc(item.description || '');
    setIReward(String(item.reward_naira || ''));
    setIExpiry(item.expiry_date || '');
    setICondition(item.eligibility_condition || '');
    setIRules(Array.isArray(item.eligibility_rules) ? item.eligibility_rules : []);
    setIActive(item.is_active);
    setShowItemModal(true);
  };
  const closeItemModal = () => setShowItemModal(false);

  const handleSaveItem = async () => {
    if (!iTitle || !iReward) { showToast('Title and reward required.'); return; }
    setSavingItem(true);
    const body: any = {
      title: iTitle,
      description: iDesc,
      reward_naira: Number(iReward),
      expiry_date: iExpiry || null,
      eligibility_condition: iCondition,
      eligibility_rules: iRules,
      is_active: iActive,
    };
    const method = editItem ? 'PATCH' : 'POST';
    if (editItem) body.id = editItem.id;
    const res = await fetch('/api/giftbox', {
      method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    setSavingItem(false);
    if (res.ok) { setShowItemModal(false); showToast('Giftbox item saved ✓'); fetchAll(true); }
    else showToast('Failed to save item.');
  };

  const handleDeactivate = async (item: GiftboxItem) => {
    const res = await fetch('/api/giftbox', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: item.id, is_active: !item.is_active }),
    });
    if (res.ok) { showToast(item.is_active ? 'Item deactivated' : 'Item activated'); fetchAll(true); }
    else showToast('Failed to update item.');
  };

  if (loading) return <p style={styles.empty}>Loading...</p>;

  const hasChanges = Object.keys(pending).length > 0;

  return (
    <div style={styles.page}>
      <div style={styles.grid}>
        <Link href="/bonuses-rewards/levels" style={{ ...styles.card, ...styles.levelsCard, textDecoration: 'none' }}>
          <div style={styles.cardHead}>
            <span style={styles.cardTitle}>Levels</span>
            <span
              onClick={(e) => { e.preventDefault(); e.stopPropagation(); toggleKey('levels_active'); }}
              style={{ display: 'inline-flex' }}
            >
              <Toggle on={getToggle('levels_active')} onClick={() => {}} />
            </span>
          </div>
          <div style={styles.levelsBody}>
            <div style={styles.levelsRow}>
              <span style={styles.levelsLabel}>Tiers</span>
              <span style={styles.levelsValue}>{stats?.level_tier_count ?? 6}</span>
            </div>
            <div style={styles.levelsRow}>
              <span style={styles.levelsLabel}>Claims today</span>
              <span style={styles.levelsValue}>{stats?.level_claims_today ?? 0}</span>
            </div>
          </div>
          <span style={styles.levelsCta}>Configure tiers & badges →</span>
        </Link>

        <div style={styles.card}>
          <div style={styles.cardHead}>
            <span style={styles.cardTitle}>Signup Bonus</span>
            <Toggle on={getToggle('signup_bonus_active')} onClick={() => toggleKey('signup_bonus_active')} />
          </div>
          <Row label="Amount (₦)">
            <input style={styles.smallInput} type="number" value={getValue('signup_bonus_amount')} onChange={(e) => setValue('signup_bonus_amount', e.target.value)} />
          </Row>
          <Row label="Condition">
            <select style={styles.smallSelect} value={getValue('signup_bonus_condition')} onChange={(e) => setValue('signup_bonus_condition', e.target.value)}>
              <option value="click_activate">Click Activate</option>
              <option value="first_trade">First Trade</option>
              <option value="first_withdrawal">First Withdrawal</option>
            </select>
          </Row>
          <div style={styles.stat}>Awarded today: <b>{stats?.signup_awarded_today ?? 0}</b> · Total: <b>{stats?.signup_awarded_total ?? 0}</b></div>
        </div>

        <div style={styles.card}>
          <div style={styles.cardHead}>
            <span style={styles.cardTitle}>Anniversary Bonus</span>
            <Toggle on={getToggle('anniversary_bonus_active')} onClick={() => toggleKey('anniversary_bonus_active')} />
          </div>
          <Row label="Amount (₦)">
            <input style={styles.smallInput} type="number" value={getValue('anniversary_bonus_amount')} onChange={(e) => setValue('anniversary_bonus_amount', e.target.value)} />
          </Row>
          <div style={styles.stat}>Awarded today: <b>{stats?.anniversary_awarded_today ?? 0}</b></div>
        </div>

        <div style={{ ...styles.card, opacity: 0.5 }}>
          <div style={styles.cardHead}>
            <span style={styles.cardTitle}>Leaderboard</span>
            <span style={styles.comingBadge}>Coming Soon</span>
          </div>
          <div style={{ ...styles.stat, marginTop: 12 }}>Leaderboard config will be exposed in a later phase.</div>
        </div>
      </div>

      <button
        style={{ ...styles.saveAllBtn, opacity: saving ? 0.7 : 1 }}
        onClick={handleSaveAll}
        disabled={saving}
      >
        {saving ? 'Saving...' : `Save All Bonus Settings${hasChanges ? ` (${Object.keys(pending).length})` : ''}`}
      </button>

      <div style={styles.section}>
        <div style={styles.sectionHead}>
          <span style={styles.sectionTitle}>Giftbox Items</span>
          <button style={styles.addBtn} onClick={openAddItem}>+ Add Item</button>
        </div>

        {items.length === 0 ? (
          <p style={styles.empty}>No giftbox items yet.</p>
        ) : (
          <div style={styles.tableWrap}>
            <table style={styles.table}>
              <thead>
                <tr>
                  <th style={styles.th}>Title</th>
                  <th style={styles.th}>Description</th>
                  <th style={styles.th}>Reward</th>
                  <th style={styles.th}>Expiry</th>
                  <th style={styles.th}>Rules</th>
                  <th style={styles.th}>Claims</th>
                  <th style={styles.th}>Status</th>
                  <th style={styles.th}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {items.map((it) => (
                  <tr key={it.id}>
                    <td style={styles.td}>{it.title}</td>
                    <td style={{ ...styles.td, ...styles.truncate }} title={it.description || ''}>{it.description || '—'}</td>
                    <td style={styles.td}>₦{Number(it.reward_naira).toLocaleString()}</td>
                    <td style={styles.td}>{it.expiry_date || '—'}</td>
                    <td style={styles.td} title={(it.eligibility_rules || []).map((r: Rule) => r.type).join(', ') || ''}>
                      {(it.eligibility_rules || []).length === 0 ? '—' : `${(it.eligibility_rules || []).length} rule${(it.eligibility_rules || []).length === 1 ? '' : 's'}`}
                    </td>
                    <td style={styles.td}>{it.claims}</td>
                    <td style={styles.td}>
                      <span style={it.is_active ? styles.badgeActive : styles.badgeInactive}>
                        {it.is_active ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                    <td style={styles.td}>
                      <button style={styles.editBtn} onClick={() => openEditItem(it)}>Edit</button>
                      <button style={styles.deactivateBtn} onClick={() => handleDeactivate(it)}>
                        {it.is_active ? 'Deactivate' : 'Activate'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {showItemModal && (
        <>
          <div style={styles.modalOverlay} onClick={closeItemModal} />
          <div style={styles.modal}>
            <p style={styles.modalTitle}>{editItem ? 'Edit Giftbox Item' : 'Add Giftbox Item'}</p>

            <div style={styles.fieldGroup}>
              <label style={styles.fieldLabel}>TITLE</label>
              <input style={styles.input} value={iTitle} onChange={(e) => setITitle(e.target.value)} />
            </div>
            <div style={styles.fieldGroup}>
              <label style={styles.fieldLabel}>DESCRIPTION</label>
              <textarea style={{ ...styles.input, minHeight: 70, resize: 'vertical' }} value={iDesc} onChange={(e) => setIDesc(e.target.value)} />
            </div>
            <div style={styles.fieldRow}>
              <div style={{ flex: 1 }}>
                <label style={styles.fieldLabel}>REWARD (₦)</label>
                <input style={styles.input} type="number" value={iReward} onChange={(e) => setIReward(e.target.value)} />
              </div>
              <div style={{ flex: 1 }}>
                <label style={styles.fieldLabel}>EXPIRY DATE</label>
                <input style={styles.input} type="date" value={iExpiry} onChange={(e) => setIExpiry(e.target.value)} />
              </div>
            </div>
            <div style={styles.fieldGroup}>
              <label style={styles.fieldLabel}>DISPLAY DESCRIPTION (shown to user)</label>
              <textarea style={{ ...styles.input, minHeight: 50, resize: 'vertical' }} placeholder="e.g. Complete 3 trades this week" value={iCondition} onChange={(e) => setICondition(e.target.value)} />
            </div>

            <RuleBuilder rules={iRules} onChange={setIRules} />

            <div style={styles.fieldGroup}>
              <label style={styles.fieldLabel}>ACTIVE</label>
              <Toggle on={iActive} onClick={() => setIActive(!iActive)} />
            </div>

            <div style={styles.modalActions}>
              <button style={styles.cancelBtn} onClick={closeItemModal}>Cancel</button>
              <button style={{ ...styles.saveBtn, opacity: savingItem ? 0.7 : 1 }} disabled={savingItem} onClick={handleSaveItem}>
                {savingItem ? 'Saving...' : 'Save'}
              </button>
            </div>
          </div>
        </>
      )}

      {toast && <div style={styles.toast}>{toast}</div>}
    </div>
  );
}

function RuleBuilder({ rules, onChange }: { rules: Rule[]; onChange: (r: Rule[]) => void }) {
  const update = (i: number, patch: Partial<Rule>) =>
    onChange(rules.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  const remove = (i: number) => onChange(rules.filter((_, idx) => idx !== i));
  const add = () => onChange([...rules, { type: 'min_trades', value: 1 }]);

  const changeType = (i: number, type: string) => {
    const def = RULE_TYPES.find((r) => r.type === type);
    let value: any = null;
    if (def?.input === 'int' || def?.input === 'number') value = 0;
    else if (def?.input === 'string') value = '';
    else if (def?.input === 'csv') value = [];
    else if (def?.input === 'count_days') value = { count: 1, days: 7 };
    else if (def?.input === 'amount_days') value = { amount: 100, days: 7 };
    else if (def?.input === 'amount_card') value = { amount: 100, card: '' };
    update(i, { type, value });
  };

  return (
    <div style={ruleStyles.section}>
      <div style={ruleStyles.head}>
        <label style={ruleStyles.label}>ELIGIBILITY RULES <span style={ruleStyles.sub}>(all must pass · empty = no restrictions)</span></label>
        <button type="button" style={ruleStyles.addBtn} onClick={add}>+ Add Rule</button>
      </div>
      {rules.length === 0 ? (
        <p style={ruleStyles.empty}>No rules — anyone eligible.</p>
      ) : (
        <div style={ruleStyles.list}>
          {rules.map((r, i) => {
            const def = RULE_TYPES.find((d) => d.type === r.type);
            return (
              <div key={i} style={ruleStyles.row}>
                <select style={ruleStyles.select} value={r.type} onChange={(e) => changeType(i, e.target.value)}>
                  {RULE_TYPES.map((rt) => (
                    <option key={rt.type} value={rt.type}>{rt.label}</option>
                  ))}
                </select>
                <RuleValue def={def} value={r.value} onChange={(v) => update(i, { value: v })} />
                <button type="button" style={ruleStyles.removeBtn} onClick={() => remove(i)}>✕</button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function RuleValue({ def, value, onChange }: { def: any; value: any; onChange: (v: any) => void }) {
  if (!def || def.input === 'none') return <span style={ruleStyles.noValue}>—</span>;
  if (def.input === 'int' || def.input === 'number') {
    return <input style={ruleStyles.valueInput} type="number" value={value ?? ''} onChange={(e) => onChange(def.input === 'int' ? parseInt(e.target.value || '0', 10) : Number(e.target.value || 0))} />;
  }
  if (def.input === 'string') {
    return <input style={ruleStyles.valueInput} value={value ?? ''} onChange={(e) => onChange(e.target.value)} placeholder="e.g. Amazon" />;
  }
  if (def.input === 'csv') {
    const text = Array.isArray(value) ? value.join(', ') : '';
    return <input style={ruleStyles.valueInput} value={text} onChange={(e) => onChange(e.target.value.split(',').map((s) => s.trim()).filter(Boolean))} placeholder="NG, GH, KE" />;
  }
  if (def.input === 'count_days') {
    return (
      <div style={ruleStyles.compound}>
        <input style={ruleStyles.smallNum} type="number" value={value?.count ?? ''} onChange={(e) => onChange({ ...value, count: parseInt(e.target.value || '0', 10) })} placeholder="N" />
        <span style={ruleStyles.compoundLabel}>trades in</span>
        <input style={ruleStyles.smallNum} type="number" value={value?.days ?? ''} onChange={(e) => onChange({ ...value, days: parseInt(e.target.value || '0', 10) })} placeholder="days" />
        <span style={ruleStyles.compoundLabel}>days</span>
      </div>
    );
  }
  if (def.input === 'amount_days') {
    return (
      <div style={ruleStyles.compound}>
        <input style={ruleStyles.smallNum} type="number" value={value?.amount ?? ''} onChange={(e) => onChange({ ...value, amount: Number(e.target.value || 0) })} placeholder="$" />
        <span style={ruleStyles.compoundLabel}>in</span>
        <input style={ruleStyles.smallNum} type="number" value={value?.days ?? ''} onChange={(e) => onChange({ ...value, days: parseInt(e.target.value || '0', 10) })} placeholder="days" />
        <span style={ruleStyles.compoundLabel}>days</span>
      </div>
    );
  }
  if (def.input === 'amount_card') {
    return (
      <div style={ruleStyles.compound}>
        <span style={ruleStyles.compoundLabel}>$</span>
        <input style={ruleStyles.smallNum} type="number" value={value?.amount ?? ''} onChange={(e) => onChange({ ...value, amount: Number(e.target.value || 0) })} placeholder="amt" />
        <span style={ruleStyles.compoundLabel}>on</span>
        <input style={{ ...ruleStyles.valueInput, width: 110 }} value={value?.card ?? ''} onChange={(e) => onChange({ ...value, card: e.target.value })} placeholder="card (blank=any)" />
      </div>
    );
  }
  return null;
}

const ruleStyles: Record<string, React.CSSProperties> = {
  section: { marginBottom: 14, backgroundColor: '#FAFAFA', borderRadius: 8, padding: 10, border: '1px solid #EEEEEE' },
  head: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  label: { fontSize: 11, fontWeight: 700, color: '#888888', textTransform: 'uppercase', letterSpacing: '0.04em' },
  sub: { fontSize: 10, fontWeight: 500, textTransform: 'none', letterSpacing: 0, color: '#AAAAAA', marginLeft: 6 },
  addBtn: { backgroundColor: '#111111', color: '#FFFFFF', border: 'none', borderRadius: 6, padding: '4px 10px', fontSize: 11, fontWeight: 700, cursor: 'pointer' },
  empty: { fontSize: 11, color: '#AAAAAA', margin: 0, padding: '4px 0' },
  list: { display: 'flex', flexDirection: 'column', gap: 6 },
  row: { display: 'flex', gap: 6, alignItems: 'center' },
  select: { flex: '1 1 auto', minWidth: 0, border: '1px solid #DDDDDD', borderRadius: 6, padding: '6px 8px', fontSize: 11, backgroundColor: '#FFFFFF' },
  valueInput: { width: 90, border: '1px solid #DDDDDD', borderRadius: 6, padding: '6px 8px', fontSize: 11, backgroundColor: '#FFFFFF' },
  noValue: { width: 90, fontSize: 11, color: '#BBBBBB', textAlign: 'center' },
  compound: { display: 'flex', gap: 4, alignItems: 'center' },
  smallNum: { width: 50, border: '1px solid #DDDDDD', borderRadius: 6, padding: '6px 6px', fontSize: 11, backgroundColor: '#FFFFFF' },
  compoundLabel: { fontSize: 10, color: '#888888' },
  removeBtn: { backgroundColor: '#FFEBEE', color: '#C62828', border: 'none', borderRadius: 6, padding: '6px 9px', fontSize: 11, fontWeight: 700, cursor: 'pointer' },
};

function Toggle({ on, onClick }: { on: boolean; onClick: () => void }) {
  return (
    <div style={{ ...styles.toggle, backgroundColor: on ? '#111111' : '#E0E0E0' }} onClick={onClick}>
      <div style={{ ...styles.toggleThumb, left: on ? 22 : 2 }} />
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={styles.row}>
      <span style={styles.rowLabel}>{label}</span>
      {children}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  page: { paddingBottom: 80 },
  empty: { fontSize: 12, color: '#888888', padding: 20, textAlign: 'center' },

  grid: { display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 12, marginBottom: 16 },
  card: { backgroundColor: '#F7F7F7', borderRadius: 10, padding: '12px 14px' },
  cardHead: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 },
  cardTitle: { fontSize: 12, fontWeight: 700, color: '#111111' },
  row: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 },
  rowLabel: { fontSize: 10, color: '#888888' },
  smallInput: { width: 80, border: '1.5px solid #E8E8E8', borderRadius: 6, padding: '4px 8px', fontSize: 11, color: '#111111', outline: 'none', backgroundColor: '#FFFFFF' },
  smallSelect: { width: 120, border: '1.5px solid #E8E8E8', borderRadius: 6, padding: '4px 8px', fontSize: 11, color: '#111111', outline: 'none', backgroundColor: '#FFFFFF' },
  stat: { fontSize: 10, color: '#555555', marginTop: 6 },
  comingBadge: { fontSize: 10, fontWeight: 600, color: '#888888', backgroundColor: '#EEEEEE', padding: '2px 8px', borderRadius: 10 },

  levelsCard: { cursor: 'pointer', color: '#111111', display: 'flex', flexDirection: 'column', justifyContent: 'space-between' },
  levelsBody: { display: 'flex', flexDirection: 'column', gap: 4, marginTop: 4 },
  levelsRow: { display: 'flex', justifyContent: 'space-between', alignItems: 'center' },
  levelsLabel: { fontSize: 10, color: '#888888' },
  levelsValue: { fontSize: 13, fontWeight: 700, color: '#111111' },
  levelsCta: { fontSize: 11, fontWeight: 700, color: '#111111', marginTop: 10 },

  toggle: { width: 44, height: 24, borderRadius: 100, position: 'relative', cursor: 'pointer', transition: 'background-color 0.25s', flexShrink: 0 },
  toggleThumb: { position: 'absolute', top: 2, width: 20, height: 20, borderRadius: '50%', backgroundColor: '#FFFFFF', boxShadow: '0 1px 3px rgba(0,0,0,0.2)', transition: 'left 0.25s' },

  section: { backgroundColor: '#FFFFFF', borderRadius: 10, padding: 16, marginTop: 16 },
  sectionHead: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 },
  sectionTitle: { fontSize: 13, fontWeight: 700, color: '#111111' },
  addBtn: { backgroundColor: '#111111', color: '#FFFFFF', border: 'none', borderRadius: 100, padding: '6px 14px', fontSize: 12, fontWeight: 700, cursor: 'pointer' },

  tableWrap: { overflowX: 'auto' },
  table: { width: '100%', borderCollapse: 'collapse', fontSize: 12 },
  th: { backgroundColor: '#111111', color: '#FFFFFF', textAlign: 'left', padding: '8px 10px', fontWeight: 600, fontSize: 11 },
  td: { padding: '8px 10px', borderBottom: '1px solid #EEEEEE', color: '#333333', verticalAlign: 'middle' },
  truncate: { maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },

  badgeActive: { backgroundColor: '#E8F5E9', color: '#2E7D32', padding: '2px 8px', borderRadius: 10, fontSize: 10, fontWeight: 600 },
  badgeInactive: { backgroundColor: '#EBEBEB', color: '#666', padding: '2px 8px', borderRadius: 10, fontSize: 10, fontWeight: 600 },

  editBtn: { backgroundColor: '#E3F2FD', color: '#1565C0', border: 'none', borderRadius: 6, padding: '4px 10px', fontSize: 11, fontWeight: 600, cursor: 'pointer', marginRight: 6 },
  deactivateBtn: { backgroundColor: '#FFEBEE', color: '#C62828', border: 'none', borderRadius: 6, padding: '4px 10px', fontSize: 11, fontWeight: 600, cursor: 'pointer' },

  saveAllBtn: { position: 'fixed', bottom: 24, right: 24, backgroundColor: '#111111', color: '#FFFFFF', border: 'none', borderRadius: 100, padding: '12px 24px', fontSize: 14, fontWeight: 700, cursor: 'pointer', zIndex: 50, boxShadow: '0 4px 12px rgba(0,0,0,0.15)' },

  modalOverlay: { position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.4)', zIndex: 99 },
  modal: { position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%,-50%)', backgroundColor: '#FFFFFF', borderRadius: 12, padding: 24, width: 440, zIndex: 100, maxHeight: '85vh', overflowY: 'auto' },
  modalTitle: { fontSize: 15, fontWeight: 800, color: '#111111', margin: '0 0 20px' },
  fieldGroup: { marginBottom: 14 },
  fieldRow: { display: 'flex', gap: 12, marginBottom: 14 },
  fieldLabel: { display: 'block', fontSize: 11, fontWeight: 600, color: '#888888', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 4 },
  input: { width: '100%', border: '1.5px solid #E8E8E8', borderRadius: 8, padding: '10px 14px', fontSize: 13, color: '#111111', outline: 'none', boxSizing: 'border-box', backgroundColor: '#FFFFFF' },
  modalActions: { display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 16 },
  cancelBtn: { backgroundColor: '#F7F7F7', color: '#333333', border: 'none', borderRadius: 8, padding: '8px 20px', fontSize: 13, fontWeight: 600, cursor: 'pointer' },
  saveBtn: { backgroundColor: '#111111', color: '#FFFFFF', border: 'none', borderRadius: 100, padding: '8px 20px', fontSize: 12, fontWeight: 700, cursor: 'pointer' },

  toast: { position: 'fixed', bottom: 80, right: 24, backgroundColor: '#111111', color: '#FFFFFF', padding: '10px 20px', borderRadius: 8, fontSize: 13, fontWeight: 600, zIndex: 51 },
};
