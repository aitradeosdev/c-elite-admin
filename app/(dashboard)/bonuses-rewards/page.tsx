'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  PageHeader, Card, CardHeader, CardBody,
  Table, THead, TBody, Tr, Th, Td, TableEmpty,
  Button, Input, Textarea, Select, FieldShell, Toggle, Modal,
} from '../../_ui';
import { useIsMobile } from '../../lib/useIsMobile';
import { formatNaira, StatusDot } from '../_shared/statusUi';

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
}

const CONFIG_KEYS = [
  'levels_active',
  'signup_bonus_active', 'signup_bonus_amount', 'signup_bonus_condition',
];

function GiftboxMobile({ items, onEdit, onToggle }: { items: GiftboxItem[]; onEdit: (i: GiftboxItem) => void; onToggle: (i: GiftboxItem) => void }) {
  if (items.length === 0) {
    return (
      <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-default)', borderRadius: 'var(--radius-xl)', padding: '48px 20px', textAlign: 'center', color: 'var(--fg-tertiary)', fontSize: 'var(--text-md)' }}>
        No giftbox items yet.
      </div>
    );
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {items.map((it) => {
        const ruleCount = (it.eligibility_rules || []).length;
        return (
          <div key={it.id} style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-default)', borderRadius: 'var(--radius-xl)', padding: 14 }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10 }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 'var(--text-md)', fontWeight: 700, color: 'var(--fg-primary)' }}>{it.title}</div>
                <div style={{ fontSize: 'var(--text-xs)', color: 'var(--fg-tertiary)', marginTop: 2 }}>{it.description || '—'}</div>
              </div>
              <StatusDot status={it.is_active ? 'Active' : 'Inactive'} tone={it.is_active ? 'success' : 'neutral'} />
            </div>
            <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 10, marginTop: 10 }}>
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-lg)', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{formatNaira(it.reward_naira)}</span>
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)', color: 'var(--fg-tertiary)' }}>
                {ruleCount === 0 ? 'no rules' : `${ruleCount} rule${ruleCount === 1 ? '' : 's'}`} · {it.claims} claims · exp {it.expiry_date || '—'}
              </span>
            </div>
            <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
              <Button variant="ghost" size="sm" onClick={() => onEdit(it)}>Edit</Button>
              <Button variant={it.is_active ? 'dangerSubtle' : 'secondary'} size="sm" onClick={() => onToggle(it)}>
                {it.is_active ? 'Deactivate' : 'Activate'}
              </Button>
            </div>
          </div>
        );
      })}
    </div>
  );
}

export default function BonusesPage() {
  const isMobile = useIsMobile();
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

  const hasChanges = Object.keys(pending).length > 0;

  if (loading) {
    return (
      <div>
        <PageHeader title="Bonuses & Rewards" subtitle="Configure signup bonuses, level tiers, and giftbox rewards." />
        <p style={{ fontSize: 'var(--text-sm)', color: 'var(--fg-tertiary)', padding: 20 }}>Loading…</p>
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title="Bonuses & Rewards"
        subtitle="Configure signup bonuses, level tiers, and giftbox rewards."
        actions={
          <Button variant="primary" size="sm" loading={saving} disabled={saving} onClick={handleSaveAll}>
            {saving ? 'Saving…' : `Save All Bonus Settings${hasChanges ? ` (${Object.keys(pending).length})` : ''}`}
          </Button>
        }
      />

      <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : 'repeat(2, minmax(0, 1fr))', gap: 'var(--space-4)', marginBottom: 'var(--space-4)' }}>
        <Link href="/bonuses-rewards/levels" style={{ textDecoration: 'none', color: 'inherit' }}>
          <Card>
            <CardHeader
              title="Levels"
              actions={
                <span
                  onClick={(e) => { e.preventDefault(); e.stopPropagation(); }}
                  style={{ display: 'inline-flex' }}
                >
                  <Toggle checked={getToggle('levels_active')} onChange={() => toggleKey('levels_active')} />
                </span>
              }
            />
            <CardBody>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontSize: 'var(--text-xs)', color: 'var(--fg-tertiary)' }}>Tiers</span>
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-md)', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{stats?.level_tier_count ?? 6}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontSize: 'var(--text-xs)', color: 'var(--fg-tertiary)' }}>Claims today</span>
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-md)', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{stats?.level_claims_today ?? 0}</span>
                </div>
              </div>
              <div style={{ fontSize: 'var(--text-xs)', fontWeight: 700, color: 'var(--fg-primary)', marginTop: 12 }}>Configure tiers &amp; badges →</div>
            </CardBody>
          </Card>
        </Link>

        <Card>
          <CardHeader
            title="Signup Bonus"
            actions={<Toggle checked={getToggle('signup_bonus_active')} onChange={() => toggleKey('signup_bonus_active')} />}
          />
          <CardBody>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 12 }}>
              <FieldShell label="Amount (₦)">
                <Input type="number" mono value={getValue('signup_bonus_amount')} onChange={(e) => setValue('signup_bonus_amount', e.target.value)} />
              </FieldShell>
              <FieldShell label="Condition">
                <Select value={getValue('signup_bonus_condition')} onChange={(e) => setValue('signup_bonus_condition', e.target.value)}>
                  <option value="click_activate">Click Activate</option>
                  <option value="first_trade">First Trade</option>
                  <option value="first_withdrawal">First Withdrawal</option>
                </Select>
              </FieldShell>
            </div>
            <p style={{ fontSize: 'var(--text-xs)', color: 'var(--fg-tertiary)', margin: '12px 0 0' }}>
              Awarded today: <b style={{ color: 'var(--fg-secondary)' }}>{stats?.signup_awarded_today ?? 0}</b> · Total: <b style={{ color: 'var(--fg-secondary)' }}>{stats?.signup_awarded_total ?? 0}</b>
            </p>
          </CardBody>
        </Card>

        <Card style={{ opacity: 0.6 }}>
          <CardHeader
            title="Leaderboard"
            actions={
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10.5, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--fg-tertiary)', border: '1px solid var(--border-default)', borderRadius: 'var(--radius-md)', padding: '3px 8px' }}>
                Coming Soon
              </span>
            }
          />
          <CardBody>
            <p style={{ fontSize: 'var(--text-xs)', color: 'var(--fg-tertiary)', margin: 0 }}>Leaderboard config will be exposed in a later phase.</p>
          </CardBody>
        </Card>
      </div>

      <Card>
        <CardHeader
          title="Giftbox Items"
          actions={<Button variant="primary" size="sm" onClick={openAddItem}>+ Add Item</Button>}
        />
        {isMobile ? (
          <CardBody>
            <GiftboxMobile items={items} onEdit={openEditItem} onToggle={handleDeactivate} />
          </CardBody>
        ) : (
          <CardBody flush>
            <Table flush>
              <THead>
                <Tr>
                  <Th>Title</Th>
                  <Th>Description</Th>
                  <Th align="right">Reward</Th>
                  <Th>Expiry</Th>
                  <Th>Rules</Th>
                  <Th align="right">Claims</Th>
                  <Th>Status</Th>
                  <Th align="right">Actions</Th>
                </Tr>
              </THead>
              <TBody>
                {items.length === 0 ? (
                  <TableEmpty colSpan={8}>No giftbox items yet.</TableEmpty>
                ) : items.map((it) => {
                  const ruleCount = (it.eligibility_rules || []).length;
                  return (
                    <Tr key={it.id}>
                      <Td emphasis="primary">{it.title}</Td>
                      <Td emphasis="secondary" title={it.description || ''} style={{ maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{it.description || '—'}</Td>
                      <Td align="right" mono emphasis="primary">{formatNaira(it.reward_naira)}</Td>
                      <Td emphasis="secondary" mono>{it.expiry_date || '—'}</Td>
                      <Td emphasis="secondary" title={(it.eligibility_rules || []).map((r: Rule) => r.type).join(', ') || ''}>
                        {ruleCount === 0 ? '—' : `${ruleCount} rule${ruleCount === 1 ? '' : 's'}`}
                      </Td>
                      <Td align="right" mono>{it.claims}</Td>
                      <Td><StatusDot status={it.is_active ? 'Active' : 'Inactive'} tone={it.is_active ? 'success' : 'neutral'} /></Td>
                      <Td align="right">
                        <div style={{ display: 'inline-flex', gap: 6 }}>
                          <Button variant="ghost" size="sm" onClick={() => openEditItem(it)}>Edit</Button>
                          <Button variant={it.is_active ? 'dangerSubtle' : 'secondary'} size="sm" onClick={() => handleDeactivate(it)}>
                            {it.is_active ? 'Deactivate' : 'Activate'}
                          </Button>
                        </div>
                      </Td>
                    </Tr>
                  );
                })}
              </TBody>
            </Table>
          </CardBody>
        )}
      </Card>

      <Modal
        open={showItemModal}
        onClose={closeItemModal}
        title={editItem ? 'Edit Giftbox Item' : 'Add Giftbox Item'}
        footer={
          <>
            <Button variant="secondary" size="sm" onClick={closeItemModal}>Cancel</Button>
            <Button variant="primary" size="sm" loading={savingItem} disabled={savingItem} onClick={handleSaveItem}>
              {savingItem ? 'Saving…' : 'Save'}
            </Button>
          </>
        }
      >
        <div style={{ display: 'grid', gap: 'var(--space-4)' }}>
          <FieldShell label="Title">
            <Input value={iTitle} onChange={(e) => setITitle(e.target.value)} />
          </FieldShell>
          <FieldShell label="Description">
            <Textarea style={{ minHeight: 70 }} value={iDesc} onChange={(e) => setIDesc(e.target.value)} />
          </FieldShell>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 12 }}>
            <FieldShell label="Reward (₦)">
              <Input type="number" mono value={iReward} onChange={(e) => setIReward(e.target.value)} />
            </FieldShell>
            <FieldShell label="Expiry Date">
              <Input type="date" value={iExpiry} onChange={(e) => setIExpiry(e.target.value)} />
            </FieldShell>
          </div>
          <FieldShell label="Display description (shown to user)">
            <Textarea style={{ minHeight: 50 }} placeholder="e.g. Complete 3 trades this week" value={iCondition} onChange={(e) => setICondition(e.target.value)} />
          </FieldShell>

          <RuleBuilder rules={iRules} onChange={setIRules} />

          <FieldShell label="Active">
            <Toggle checked={iActive} onChange={() => setIActive(!iActive)} />
          </FieldShell>
        </div>
      </Modal>

      {toast && (
        <div style={{ position: 'fixed', bottom: 24, right: 24, background: 'var(--fg-primary)', color: 'var(--bg-base)', padding: '10px 18px', borderRadius: 'var(--radius-lg)', fontSize: 'var(--text-sm)', fontWeight: 600, zIndex: 51 }}>
          {toast}
        </div>
      )}
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
    <div style={{ background: 'var(--bg-subtle)', borderRadius: 'var(--radius-lg)', padding: 10, border: '1px solid var(--border-default)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, fontWeight: 700, color: 'var(--fg-tertiary)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
          Eligibility Rules <span style={{ fontWeight: 500, textTransform: 'none', letterSpacing: 0, marginLeft: 6 }}>(all must pass · empty = no restrictions)</span>
        </span>
        <Button type="button" variant="secondary" size="sm" onClick={add}>+ Add Rule</Button>
      </div>
      {rules.length === 0 ? (
        <p style={{ fontSize: 'var(--text-xs)', color: 'var(--fg-tertiary)', margin: 0, padding: '4px 0' }}>No rules — anyone eligible.</p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {rules.map((r, i) => {
            const def = RULE_TYPES.find((d) => d.type === r.type);
            return (
              <div key={i} style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                <Select style={{ flex: '1 1 auto', minWidth: 0 }} value={r.type} onChange={(e) => changeType(i, e.target.value)}>
                  {RULE_TYPES.map((rt) => (
                    <option key={rt.type} value={rt.type}>{rt.label}</option>
                  ))}
                </Select>
                <RuleValue def={def} value={r.value} onChange={(v) => update(i, { value: v })} />
                <Button type="button" variant="dangerSubtle" size="sm" iconOnly onClick={() => remove(i)}>✕</Button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function RuleValue({ def, value, onChange }: { def: any; value: any; onChange: (v: any) => void }) {
  if (!def || def.input === 'none') return <span style={{ width: 90, fontSize: 'var(--text-xs)', color: 'var(--fg-tertiary)', textAlign: 'center' }}>—</span>;
  if (def.input === 'int' || def.input === 'number') {
    return <Input mono style={{ width: 90 }} type="number" value={value ?? ''} onChange={(e) => onChange(def.input === 'int' ? parseInt(e.target.value || '0', 10) : Number(e.target.value || 0))} />;
  }
  if (def.input === 'string') {
    return <Input style={{ width: 90 }} value={value ?? ''} onChange={(e) => onChange(e.target.value)} placeholder="e.g. Amazon" />;
  }
  if (def.input === 'csv') {
    const text = Array.isArray(value) ? value.join(', ') : '';
    return <Input style={{ width: 90 }} value={text} onChange={(e) => onChange(e.target.value.split(',').map((s) => s.trim()).filter(Boolean))} placeholder="NG, GH, KE" />;
  }
  if (def.input === 'count_days') {
    return (
      <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
        <Input mono style={{ width: 50 }} type="number" value={value?.count ?? ''} onChange={(e) => onChange({ ...value, count: parseInt(e.target.value || '0', 10) })} placeholder="N" />
        <span style={{ fontSize: 10, color: 'var(--fg-tertiary)' }}>trades in</span>
        <Input mono style={{ width: 50 }} type="number" value={value?.days ?? ''} onChange={(e) => onChange({ ...value, days: parseInt(e.target.value || '0', 10) })} placeholder="days" />
        <span style={{ fontSize: 10, color: 'var(--fg-tertiary)' }}>days</span>
      </div>
    );
  }
  if (def.input === 'amount_days') {
    return (
      <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
        <Input mono style={{ width: 50 }} type="number" value={value?.amount ?? ''} onChange={(e) => onChange({ ...value, amount: Number(e.target.value || 0) })} placeholder="$" />
        <span style={{ fontSize: 10, color: 'var(--fg-tertiary)' }}>in</span>
        <Input mono style={{ width: 50 }} type="number" value={value?.days ?? ''} onChange={(e) => onChange({ ...value, days: parseInt(e.target.value || '0', 10) })} placeholder="days" />
        <span style={{ fontSize: 10, color: 'var(--fg-tertiary)' }}>days</span>
      </div>
    );
  }
  if (def.input === 'amount_card') {
    return (
      <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
        <span style={{ fontSize: 10, color: 'var(--fg-tertiary)' }}>$</span>
        <Input mono style={{ width: 50 }} type="number" value={value?.amount ?? ''} onChange={(e) => onChange({ ...value, amount: Number(e.target.value || 0) })} placeholder="amt" />
        <span style={{ fontSize: 10, color: 'var(--fg-tertiary)' }}>on</span>
        <Input style={{ width: 110 }} value={value?.card ?? ''} onChange={(e) => onChange({ ...value, card: e.target.value })} placeholder="card (blank=any)" />
      </div>
    );
  }
  return null;
}
