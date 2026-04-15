'use client';

import React from 'react';

export interface Rule { type: string; value: any }

export const RULE_TYPES: Array<{ type: string; label: string; input: 'int' | 'number' | 'string' | 'none' | 'count_days' | 'amount_days' | 'csv' | 'amount_card' }> = [
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
  { type: 'first_time_claimer', label: 'First-time claimer', input: 'none' },
  { type: 'min_balance_naira', label: 'Min wallet balance (₦)', input: 'number' },
  { type: 'min_withdrawn_total', label: 'Min lifetime withdrawals (₦)', input: 'number' },
  { type: 'has_used_coupon', label: 'Has used a coupon', input: 'none' },
  { type: 'completed_task', label: 'Completed N tasks', input: 'int' },
  { type: 'consecutive_days_active', label: 'Consecutive active days', input: 'int' },
];

export function RuleBuilder({ rules, onChange }: { rules: Rule[]; onChange: (r: Rule[]) => void }) {
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
