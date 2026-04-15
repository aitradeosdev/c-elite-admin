'use client';

import { useEffect, useState, useRef } from 'react';

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

  // Add denomination modal
  const [addDenomTypeId, setAddDenomTypeId] = useState<string | null>(null);
  const [rangeLabel, setRangeLabel] = useState('');
  const [minValue, setMinValue] = useState('');
  const [maxValue, setMaxValue] = useState('');
  const [rateNaira, setRateNaira] = useState('');
  const [denomActive, setDenomActive] = useState(true);
  const [addingDenom, setAddingDenom] = useState(false);

  useEffect(() => { fetchRates(); }, []);

  const fetchRates = async () => {
    setLoading(true);
    const res = await fetch('/api/rates');
    const data = await res.json();
    setCards(data.cards || []);
    setLoading(false);
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
      fetchRates();
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
    fetchRates();
  };

  const hasChanges = Object.keys(changes).length > 0;

  if (loading) return <p style={styles.emptyText}>Loading...</p>;

  return (
    <div style={styles.page}>
      {cards.length === 0 && <p style={styles.emptyText}>No active cards found. Add cards first.</p>}

      {cards.map((card) => (
        <div key={card.id} style={styles.cardBlock}>
          {/* Level 1 — Card Brand */}
          <div style={styles.level1Row} onClick={() => setOpenCards(toggle(openCards, card.id))}>
            <div style={styles.level1Left}>
              {card.logo_url && <img src={card.logo_url} alt={card.name} style={styles.logo} />}
              <span style={styles.level1Name}>{card.name}</span>
              <span style={styles.activeRates}>{card.activeRates} active rates</span>
            </div>
            <span style={{ ...styles.arrow, transform: openCards.has(card.id) ? 'rotate(180deg)' : 'rotate(0deg)' }}>▼</span>
          </div>

          {openCards.has(card.id) && card.countries.map((country) => (
            <div key={country.id} style={styles.level2Block}>
              {/* Level 2 — Country */}
              <div style={styles.level2Row} onClick={() => setOpenCountries(toggle(openCountries, country.id))}>
                <div style={styles.level2Left}>
                  <span style={styles.level2Name}>{country.country_name}</span>
                  <span style={styles.currencyBadge}>{country.currency_symbol}</span>
                </div>
                <span style={{ ...styles.arrow, transform: openCountries.has(country.id) ? 'rotate(180deg)' : 'rotate(0deg)' }}>▼</span>
              </div>

              {openCountries.has(country.id) && country.card_types.map((type) => (
                <div key={type.id} style={styles.level3Block}>
                  {/* Level 3 — Card Type */}
                  <div style={styles.level3Row} onClick={() => setOpenTypes(toggle(openTypes, type.id))}>
                    <span style={styles.level3Name}>{type.name}</span>
                    <span style={{ ...styles.arrow, transform: openTypes.has(type.id) ? 'rotate(180deg)' : 'rotate(0deg)' }}>▼</span>
                  </div>

                  {openTypes.has(type.id) && (
                    <div style={styles.level4Block}>
                      {type.denominations.map((denom) => (
                        <div key={denom.id} style={styles.level4Row}>
                          <span style={styles.rangeLabel}>{denom.range_label}</span>
                          <input
                            style={styles.rateInput}
                            type="number"
                            value={getRate(denom)}
                            onChange={(e) => handleRateChange(denom, e.target.value)}
                          />
                          <div
                            style={{ ...styles.toggle, backgroundColor: getActive(denom) ? '#111111' : '#E0E0E0' }}
                            onClick={() => handleToggleChange(denom)}
                          >
                            <div style={{ ...styles.toggleThumb, left: getActive(denom) ? 22 : 2 }} />
                          </div>
                        </div>
                      ))}
                      <button style={styles.addRangeBtn} onClick={() => setAddDenomTypeId(type.id)}>+ Add Range</button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          ))}
        </div>
      ))}

      {/* Save All Changes — fixed bottom right */}
      <button
        style={{ ...styles.saveAllBtn, opacity: saving ? 0.7 : 1 }}
        onClick={handleSaveAll}
        disabled={saving}
      >
        {saving ? 'Saving...' : `Save All Changes${hasChanges ? ` (${Object.keys(changes).length})` : ''}`}
      </button>

      {/* Toast */}
      {toast && <div style={styles.toast}>{toast}</div>}

      {/* Add Denomination Modal */}
      {addDenomTypeId && (
        <>
          <div style={styles.modalOverlay} onClick={() => setAddDenomTypeId(null)} />
          <div style={styles.modal}>
            <p style={styles.modalTitle}>Add Denomination Range</p>

            <div style={styles.fieldGroup}>
              <label style={styles.fieldLabel}>RANGE LABEL</label>
              <input style={styles.input} placeholder="e.g. $25–$99" value={rangeLabel} onChange={(e) => setRangeLabel(e.target.value)} />
            </div>
            <div style={styles.fieldRow}>
              <div style={{ flex: 1 }}>
                <label style={styles.fieldLabel}>MIN VALUE</label>
                <input style={styles.input} type="number" placeholder="25" value={minValue} onChange={(e) => setMinValue(e.target.value)} />
              </div>
              <div style={{ flex: 1 }}>
                <label style={styles.fieldLabel}>MAX VALUE</label>
                <input style={styles.input} type="number" placeholder="99" value={maxValue} onChange={(e) => setMaxValue(e.target.value)} />
              </div>
            </div>
            <div style={styles.fieldGroup}>
              <label style={styles.fieldLabel}>RATE IN NAIRA (per unit)</label>
              <input style={styles.input} type="number" placeholder="1500" value={rateNaira} onChange={(e) => setRateNaira(e.target.value)} />
            </div>
            <div style={styles.fieldGroup}>
              <label style={styles.fieldLabel}>ACTIVE</label>
              <div style={{ ...styles.toggle, backgroundColor: denomActive ? '#111111' : '#E0E0E0' }} onClick={() => setDenomActive(!denomActive)}>
                <div style={{ ...styles.toggleThumb, left: denomActive ? 22 : 2 }} />
              </div>
            </div>

            <div style={styles.modalActions}>
              <button style={styles.cancelBtn} onClick={() => setAddDenomTypeId(null)}>Cancel</button>
              <button
                style={{ ...styles.saveBtn, opacity: (!rangeLabel || !minValue || !maxValue || !rateNaira) ? 0.5 : 1 }}
                onClick={handleAddDenom}
                disabled={!rangeLabel || !minValue || !maxValue || !rateNaira || addingDenom}
              >
                {addingDenom ? 'Saving...' : 'Save'}
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  page: { paddingBottom: 80 },
  emptyText: { fontSize: 12, color: '#888888' },
  cardBlock: { backgroundColor: '#FFFFFF', borderRadius: 10, marginBottom: 8, overflow: 'hidden' },
  level1Row: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 16px', cursor: 'pointer' },
  level1Left: { display: 'flex', alignItems: 'center', gap: 10 },
  logo: { width: 32, height: 32, objectFit: 'contain', borderRadius: 4 },
  level1Name: { fontSize: 14, fontWeight: 700, color: '#111111' },
  activeRates: { fontSize: 12, color: '#888888' },
  arrow: { fontSize: 10, color: '#888888', transition: 'transform 0.2s' },
  level2Block: { borderTop: '1px solid #F5F5F5' },
  level2Row: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 16px 10px 32px', cursor: 'pointer', backgroundColor: '#FAFAFA' },
  level2Left: { display: 'flex', alignItems: 'center', gap: 8 },
  level2Name: { fontSize: 13, fontWeight: 600, color: '#333333' },
  currencyBadge: { backgroundColor: '#F7F7F7', borderWidth: 1, borderStyle: 'solid', borderColor: '#E8E8E8', borderRadius: 6, padding: '2px 6px', fontSize: 11, color: '#555555' },
  level3Block: { borderTop: '1px solid #F5F5F5' },
  level3Row: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '9px 16px 9px 48px', cursor: 'pointer', backgroundColor: '#FFFFFF' },
  level3Name: { fontSize: 13, fontWeight: 600, color: '#444444' },
  level4Block: { padding: '4px 16px 8px 64px', borderTop: '1px solid #F5F5F5' },
  level4Row: { display: 'flex', alignItems: 'center', gap: 12, padding: '8px 0', borderBottom: '1px solid #EEEEEE' },
  rangeLabel: { fontSize: 13, color: '#333333', minWidth: 120 },
  rateInput: { width: 120, border: '1.5px solid #E8E8E8', borderRadius: 6, padding: '6px 10px', fontSize: 13, color: '#111111', outline: 'none' },
  toggle: { width: 44, height: 24, borderRadius: 100, position: 'relative', cursor: 'pointer', transition: 'background-color 0.25s', flexShrink: 0 },
  toggleThumb: { position: 'absolute', top: 2, width: 20, height: 20, borderRadius: '50%', backgroundColor: '#FFFFFF', boxShadow: '0 1px 3px rgba(0,0,0,0.2)', transition: 'left 0.25s' },
  addRangeBtn: { background: 'none', border: 'none', cursor: 'pointer', fontSize: 11, fontWeight: 600, color: '#34C759', padding: '6px 0', marginTop: 4 },
  saveAllBtn: { position: 'fixed', bottom: 24, right: 24, backgroundColor: '#111111', color: '#FFFFFF', border: 'none', borderRadius: 100, padding: '12px 24px', fontSize: 14, fontWeight: 700, cursor: 'pointer', zIndex: 50, boxShadow: '0 4px 12px rgba(0,0,0,0.15)' },
  toast: { position: 'fixed', bottom: 80, right: 24, backgroundColor: '#111111', color: '#FFFFFF', padding: '10px 20px', borderRadius: 8, fontSize: 13, fontWeight: 600, zIndex: 51 },
  modalOverlay: { position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.4)', zIndex: 99 },
  modal: { position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%,-50%)', backgroundColor: '#FFFFFF', borderRadius: 12, padding: 24, width: 400, zIndex: 100 },
  modalTitle: { fontSize: 15, fontWeight: 800, color: '#111111', margin: '0 0 20px' },
  fieldGroup: { marginBottom: 14 },
  fieldRow: { display: 'flex', gap: 12, marginBottom: 14 },
  fieldLabel: { display: 'block', fontSize: 11, fontWeight: 600, color: '#888888', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 4 },
  input: { width: '100%', border: '1.5px solid #E8E8E8', borderRadius: 8, padding: '10px 14px', fontSize: 13, color: '#111111', outline: 'none', boxSizing: 'border-box', backgroundColor: '#FFFFFF' },
  modalActions: { display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 16 },
  cancelBtn: { backgroundColor: '#F7F7F7', color: '#333333', border: 'none', borderRadius: 8, padding: '8px 20px', fontSize: 13, fontWeight: 600, cursor: 'pointer' },
  saveBtn: { backgroundColor: '#111111', color: '#FFFFFF', border: 'none', borderRadius: 100, padding: '8px 20px', fontSize: 12, fontWeight: 700, cursor: 'pointer' },
};
