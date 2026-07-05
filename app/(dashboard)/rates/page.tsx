'use client';

import { useEffect, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import {
  PageHeader, Card, CardBody,
  Modal, FieldShell, Input, Toggle, Button,
} from '../../_ui';

interface Denomination {
  id: string;
  range_label: string;
  min_value: number;
  max_value: number;
  rate_naira: number;
  is_active: boolean;
}

interface CardType {
  id: string;
  name: string;
  denominations: Denomination[];
}

interface Country {
  id: string;
  country_code: string;
  country_name: string;
  currency_symbol: string;
  card_types: CardType[];
}

interface Card {
  id: string;
  name: string;
  logo_url: string | null;
  activeRates: number;
  countries: Country[];
}

interface Change {
  id: string;
  rate_naira: number;
  is_active: boolean;
}

export default function RatesPage() {
  const [cards, setCards] = useState<Card[]>([]);
  const [loading, setLoading] = useState(true);
  const [openCards, setOpenCards] = useState<Set<string>>(new Set());
  const [openCountries, setOpenCountries] = useState<Set<string>>(new Set());
  const [openTypes, setOpenTypes] = useState<Set<string>>(new Set());
  const [changes, setChanges] = useState<Record<string, Change>>({});
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState('');

  const [addDenomTypeId, setAddDenomTypeId] = useState<string | null>(null);
  const [rangeLabel, setRangeLabel] = useState('');
  const [minValue, setMinValue] = useState('');
  const [maxValue, setMaxValue] = useState('');
  const [rateNaira, setRateNaira] = useState('');
  const [denomActive, setDenomActive] = useState(true);
  const [addingDenom, setAddingDenom] = useState(false);

  useEffect(() => { fetchRates(); }, []);

  const fetchRates = async (silent = false) => {
    if (!silent) setLoading(true);
    const res = await fetch('/api/rates');
    const data = await res.json();
    setCards(data.cards || []);
    if (!silent) setLoading(false);
  };

  const toggle = (set: Set<string>, id: string): Set<string> => {
    const next = new Set(set);
    next.has(id) ? next.delete(id) : next.add(id);
    return next;
  };

  const handleRateChange = (denom: Denomination, newRate: string) => {
    const rate = parseFloat(newRate) || 0;
    setChanges((prev) => ({
      ...prev,
      [denom.id]: { id: denom.id, rate_naira: rate, is_active: prev[denom.id]?.is_active ?? denom.is_active },
    }));
  };

  const handleToggleChange = (denom: Denomination) => {
    setChanges((prev) => ({
      ...prev,
      [denom.id]: { id: denom.id, rate_naira: prev[denom.id]?.rate_naira ?? denom.rate_naira, is_active: !(prev[denom.id]?.is_active ?? denom.is_active) },
    }));
  };

  const getRate = (denom: Denomination) => changes[denom.id]?.rate_naira ?? denom.rate_naira;
  const getActive = (denom: Denomination) => changes[denom.id]?.is_active ?? denom.is_active;

  const handleSaveAll = async () => {
    const changeList = Object.values(changes);
    if (changeList.length === 0) { setToast('No changes to save.'); setTimeout(() => setToast(''), 3000); return; }
    setSaving(true);
    const res = await fetch('/api/rates', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ changes: changeList }),
    });
    setSaving(false);
    if (res.ok) {
      setChanges({});
      setToast('All changes saved ✓');
      setTimeout(() => setToast(''), 3000);
      fetchRates(true);
    } else {
      setToast('Failed to save changes.');
      setTimeout(() => setToast(''), 3000);
    }
  };

  const handleAddDenom = async () => {
    if (!rangeLabel || !minValue || !maxValue || !rateNaira) return;
    setAddingDenom(true);
    await fetch('/api/rates', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        card_type_id: addDenomTypeId,
        range_label: rangeLabel,
        min_value: parseFloat(minValue),
        max_value: parseFloat(maxValue),
        rate_naira: parseFloat(rateNaira),
        is_active: denomActive,
      }),
    });
    setAddingDenom(false);
    setAddDenomTypeId(null);
    setRangeLabel(''); setMinValue(''); setMaxValue(''); setRateNaira(''); setDenomActive(true);
    fetchRates(true);
  };

  const hasChanges = Object.keys(changes).length > 0;

  const saveButton = (
    <Button variant="primary" size="sm" onClick={handleSaveAll} disabled={saving} loading={saving}>
      {saving ? 'Saving…' : `Save All Changes${hasChanges ? ` (${Object.keys(changes).length})` : ''}`}
    </Button>
  );

  return (
    <div>
      <PageHeader
        title="Rates"
        subtitle="Manage gift-card buy rates by card, country, type and denomination."
        actions={saveButton}
      />

      {loading ? (
        <Card>
          <CardBody>
            <p style={{ fontSize: 'var(--text-xs)', color: 'var(--fg-tertiary)', margin: 0 }}>Loading…</p>
          </CardBody>
        </Card>
      ) : cards.length === 0 ? (
        <Card>
          <CardBody>
            <p style={{ fontSize: 'var(--text-xs)', color: 'var(--fg-tertiary)', margin: 0 }}>No active cards found. Add cards first.</p>
          </CardBody>
        </Card>
      ) : (
        <Card>
          <CardBody flush>
            {cards.map((card) => {
              const cardOpen = openCards.has(card.id);
              return (
                <div key={card.id} style={styles.cardBlock}>
                  <div style={styles.level1Row} onClick={() => setOpenCards(toggle(openCards, card.id))}>
                    <div style={styles.level1Left}>
                      {card.logo_url && <img src={card.logo_url} alt={card.name} style={styles.logo} />}
                      <span style={styles.level1Name}>{card.name}</span>
                      <span style={styles.metaBadge}>{card.activeRates} active rates</span>
                    </div>
                    <ChevronDown size={15} style={{ ...styles.chevron, transform: cardOpen ? 'rotate(180deg)' : 'rotate(0deg)' }} />
                  </div>

                  {cardOpen && card.countries.map((country) => {
                    const countryOpen = openCountries.has(country.id);
                    return (
                      <div key={country.id} style={styles.level2Block}>
                        <div style={styles.level2Row} onClick={() => setOpenCountries(toggle(openCountries, country.id))}>
                          <div style={styles.level2Left}>
                            <span style={styles.level2Name}>{country.country_name}</span>
                            <span style={styles.currencyBadge}>{country.currency_symbol}</span>
                          </div>
                          <ChevronDown size={14} style={{ ...styles.chevron, transform: countryOpen ? 'rotate(180deg)' : 'rotate(0deg)' }} />
                        </div>

                        {countryOpen && country.card_types.map((type) => {
                          const typeOpen = openTypes.has(type.id);
                          return (
                            <div key={type.id} style={styles.level3Block}>
                              <div style={styles.level3Row} onClick={() => setOpenTypes(toggle(openTypes, type.id))}>
                                <span style={styles.level3Name}>{type.name}</span>
                                <ChevronDown size={13} style={{ ...styles.chevron, transform: typeOpen ? 'rotate(180deg)' : 'rotate(0deg)' }} />
                              </div>

                              {typeOpen && (
                                <div style={styles.level4Block}>
                                  {type.denominations.map((denom) => (
                                    <div key={denom.id} style={styles.level4Row}>
                                      <span style={styles.rangeLabel}>{denom.range_label}</span>
                                      <Input
                                        type="number"
                                        mono
                                        style={{ width: 130 }}
                                        value={getRate(denom)}
                                        onChange={(e) => handleRateChange(denom, e.target.value)}
                                      />
                                      <Toggle checked={getActive(denom)} onChange={() => handleToggleChange(denom)} />
                                    </div>
                                  ))}
                                  <div style={{ paddingTop: 6 }}>
                                    <Button variant="ghost" size="sm" onClick={() => setAddDenomTypeId(type.id)}>+ Add Range</Button>
                                  </div>
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </CardBody>
        </Card>
      )}

      <Modal
        open={addDenomTypeId !== null}
        onClose={() => setAddDenomTypeId(null)}
        title="Add Denomination Range"
        size="sm"
        footer={
          <>
            <Button variant="secondary" size="sm" onClick={() => setAddDenomTypeId(null)}>Cancel</Button>
            <Button
              variant="primary"
              size="sm"
              onClick={handleAddDenom}
              loading={addingDenom}
              disabled={!rangeLabel || !minValue || !maxValue || !rateNaira || addingDenom}
            >
              {addingDenom ? 'Saving…' : 'Save'}
            </Button>
          </>
        }
      >
        <div style={{ display: 'grid', gap: 'var(--space-4)' }}>
          <FieldShell label="Range Label">
            <Input placeholder="e.g. $25–$99" value={rangeLabel} onChange={(e) => setRangeLabel(e.target.value)} />
          </FieldShell>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 'var(--space-4)' }}>
            <FieldShell label="Min Value">
              <Input type="number" mono placeholder="25" value={minValue} onChange={(e) => setMinValue(e.target.value)} />
            </FieldShell>
            <FieldShell label="Max Value">
              <Input type="number" mono placeholder="99" value={maxValue} onChange={(e) => setMaxValue(e.target.value)} />
            </FieldShell>
          </div>
          <FieldShell label="Rate in Naira (per unit)">
            <Input type="number" mono placeholder="1500" value={rateNaira} onChange={(e) => setRateNaira(e.target.value)} />
          </FieldShell>
          <FieldShell label="Active">
            <Toggle checked={denomActive} onChange={() => setDenomActive(!denomActive)} />
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

const styles: Record<string, React.CSSProperties> = {
  cardBlock: { borderBottom: '1px solid var(--border-subtle)' },
  level1Row: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 16px', cursor: 'pointer' },
  level1Left: { display: 'flex', alignItems: 'center', gap: 10 },
  logo: { width: 32, height: 32, objectFit: 'contain', borderRadius: 4 },
  level1Name: { fontSize: 'var(--text-md)', fontWeight: 700, color: 'var(--fg-primary)' },
  metaBadge: { fontFamily: 'var(--font-mono)', fontSize: 11, letterSpacing: '0.04em', color: 'var(--fg-tertiary)' },
  chevron: { color: 'var(--fg-tertiary)', transition: 'transform 0.2s', flexShrink: 0 },
  level2Block: { borderTop: '1px solid var(--border-subtle)' },
  level2Row: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 16px 10px 32px', cursor: 'pointer', background: 'var(--bg-subtle)' },
  level2Left: { display: 'flex', alignItems: 'center', gap: 8 },
  level2Name: { fontSize: 'var(--text-sm)', fontWeight: 600, color: 'var(--fg-secondary)' },
  currencyBadge: { border: '1px solid var(--border-default)', borderRadius: 6, padding: '2px 6px', fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--fg-secondary)' },
  level3Block: { borderTop: '1px solid var(--border-subtle)' },
  level3Row: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '9px 16px 9px 48px', cursor: 'pointer' },
  level3Name: { fontSize: 'var(--text-sm)', fontWeight: 600, color: 'var(--fg-secondary)' },
  level4Block: { padding: '4px 16px 10px 64px', borderTop: '1px solid var(--border-subtle)' },
  level4Row: { display: 'flex', alignItems: 'center', gap: 12, padding: '8px 0', borderBottom: '1px solid var(--border-subtle)' },
  rangeLabel: { fontSize: 'var(--text-sm)', color: 'var(--fg-secondary)', minWidth: 120 },
};
