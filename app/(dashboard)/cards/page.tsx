'use client';

import { useEffect, useRef, useState } from 'react';

const ISO_COUNTRIES = [
  { code: 'US', name: 'United States' }, { code: 'GB', name: 'United Kingdom' },
  { code: 'CA', name: 'Canada' }, { code: 'AU', name: 'Australia' },
  { code: 'DE', name: 'Germany' }, { code: 'FR', name: 'France' },
  { code: 'IT', name: 'Italy' }, { code: 'ES', name: 'Spain' },
  { code: 'NL', name: 'Netherlands' }, { code: 'SE', name: 'Sweden' },
  { code: 'NO', name: 'Norway' }, { code: 'DK', name: 'Denmark' },
  { code: 'CH', name: 'Switzerland' }, { code: 'JP', name: 'Japan' },
  { code: 'CN', name: 'China' }, { code: 'IN', name: 'India' },
  { code: 'BR', name: 'Brazil' }, { code: 'MX', name: 'Mexico' },
  { code: 'ZA', name: 'South Africa' }, { code: 'NG', name: 'Nigeria' },
  { code: 'GH', name: 'Ghana' }, { code: 'KE', name: 'Kenya' },
  { code: 'AE', name: 'United Arab Emirates' }, { code: 'SA', name: 'Saudi Arabia' },
  { code: 'SG', name: 'Singapore' }, { code: 'NZ', name: 'New Zealand' },
  { code: 'IE', name: 'Ireland' }, { code: 'PT', name: 'Portugal' },
  { code: 'PL', name: 'Poland' }, { code: 'AT', name: 'Austria' },
];

interface Country {
  id: string;
  country_code: string;
  country_name: string;
  currency_symbol: string;
  is_active: boolean;
}

interface Card {
  id: string;
  name: string;
  logo_url: string | null;
  is_active: boolean;
  sort_order: number;
  countries: Country[];
}

export default function CardsPage() {
  const [cards, setCards] = useState<Card[]>([]);
  const [loading, setLoading] = useState(true);

  // Card modal
  const [showCardModal, setShowCardModal] = useState(false);
  const [editCard, setEditCard] = useState<Card | null>(null);
  const [cardName, setCardName] = useState('');
  const [cardActive, setCardActive] = useState(true);
  const [logoUrl, setLogoUrl] = useState('');
  const [logoPreview, setLogoPreview] = useState('');
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [cardError, setCardError] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Countries panel
  const [countriesCard, setCountriesCard] = useState<Card | null>(null);
  const [newCountryCode, setNewCountryCode] = useState('');
  const [newCurrencySymbol, setNewCurrencySymbol] = useState('');
  const [newCurrencyName, setNewCurrencyName] = useState('');
  const [newCountryActive, setNewCountryActive] = useState(true);
  const [addingCountry, setAddingCountry] = useState(false);

  useEffect(() => { fetchCards(); }, []);

  const fetchCards = async () => {
    setLoading(true);
    const res = await fetch('/api/cards');
    const data = await res.json();
    setCards(data.cards || []);
    setLoading(false);
  };

  const openCreate = () => {
    setEditCard(null);
    setCardName(''); setCardActive(true); setLogoUrl(''); setLogoPreview(''); setCardError('');
    setShowCardModal(true);
  };

  const openEdit = (card: Card) => {
    setEditCard(card);
    setCardName(card.name); setCardActive(card.is_active);
    setLogoUrl(card.logo_url || ''); setLogoPreview(card.logo_url || ''); setCardError('');
    setShowCardModal(true);
  };

  const handleLogoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    const formData = new FormData();
    formData.append('file', file);
    const res = await fetch('/api/cards/upload', { method: 'POST', body: formData });
    const data = await res.json();
    setUploading(false);
    if (data.url) { setLogoUrl(data.url); setLogoPreview(data.url); }
  };

  const handleSaveCard = async () => {
    if (!cardName.trim()) { setCardError('Card name is required.'); return; }
    setSaving(true);
    setCardError('');
    const method = editCard ? 'PATCH' : 'POST';
    const body = editCard
      ? { type: 'card', id: editCard.id, name: cardName, is_active: cardActive, logo_url: logoUrl || null }
      : { type: 'card', name: cardName, is_active: cardActive, logo_url: logoUrl || null };
    const res = await fetch('/api/cards', { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const data = await res.json();
    setSaving(false);
    if (!res.ok) { setCardError(data.error || 'Failed to save.'); return; }
    setShowCardModal(false);
    fetchCards();
  };

  const handleToggleCard = async (card: Card) => {
    await fetch('/api/cards', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'card', id: card.id, is_active: !card.is_active }),
    });
    fetchCards();
  };

  const openCountries = (card: Card) => {
    setCountriesCard(card);
    setNewCountryCode(''); setNewCurrencySymbol(''); setNewCurrencyName(''); setNewCountryActive(true);
  };

  const handleAddCountry = async () => {
    if (!newCountryCode || !newCurrencySymbol || !newCurrencyName) return;
    setAddingCountry(true);
    const countryName = ISO_COUNTRIES.find((c) => c.code === newCountryCode)?.name || newCountryCode;
    await fetch('/api/cards', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'country',
        card_id: countriesCard!.id,
        country_code: newCountryCode,
        country_name: countryName,
        currency_symbol: newCurrencySymbol,
        is_active: newCountryActive,
      }),
    });
    setAddingCountry(false);
    setNewCountryCode(''); setNewCurrencySymbol(''); setNewCurrencyName('');
    await fetchCards();
    setCountriesCard((prev) => {
      const updated = cards.find((c) => c.id === prev?.id);
      return updated || prev;
    });
  };

  const handleToggleCountry = async (country: Country) => {
    await fetch('/api/cards', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'country', id: country.id, is_active: !country.is_active }),
    });
    fetchCards();
  };

  const handleRemoveCountry = async (country: Country) => {
    await fetch('/api/cards', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'country', id: country.id }),
    });
    fetchCards();
  };

  const formatCountries = (countries: Country[]) => {
    if (!countries || countries.length === 0) return '-';
    const names = countries.map((c) => c.country_name);
    if (names.length <= 2) return names.join(', ');
    return names.slice(0, 2).join(', ') + '...';
  };

  // Sync countriesCard when cards refresh
  useEffect(() => {
    if (countriesCard) {
      const updated = cards.find((c) => c.id === countriesCard.id);
      if (updated) setCountriesCard(updated);
    }
  }, [cards]);

  return (
    <div style={styles.page}>
      {/* Header */}
      <div style={styles.header}>
        <span style={styles.title}>Card & Country Management</span>
        <button style={styles.createBtn} onClick={openCreate}>+ Add Card Brand</button>
      </div>

      {/* Table */}
      <div style={styles.tableWrapper}>
        <table style={styles.table}>
          <thead>
            <tr>
              {['Logo', 'Card Name', 'Countries', 'Status', 'Sort Order', 'Actions'].map((col) => (
                <th key={col} style={styles.th}>{col}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={6} style={{ ...styles.td, textAlign: 'center', color: '#888888' }}>Loading...</td></tr>
            ) : cards.length === 0 ? (
              <tr><td colSpan={6} style={{ ...styles.td, textAlign: 'center', color: '#888888' }}>No card brands yet</td></tr>
            ) : cards.map((card, i) => (
              <tr key={card.id} style={{ backgroundColor: i % 2 === 0 ? '#FFFFFF' : '#F7F7F7' }}>
                <td style={styles.td}>
                  {card.logo_url
                    ? <img src={card.logo_url} alt={card.name} style={styles.logoThumb} />
                    : <div style={styles.logoPlaceholder} />
                  }
                </td>
                <td style={{ ...styles.td, fontWeight: 600 }}>{card.name}</td>
                <td style={styles.td}>{card.countries.length} ({formatCountries(card.countries)})</td>
                <td style={styles.td}>
                  <span style={card.is_active ? styles.badgeActive : styles.badgeInactive}>
                    {card.is_active ? 'Active' : 'Inactive'}
                  </span>
                </td>
                <td style={styles.td}>{card.sort_order}</td>
                <td style={styles.td}>
                  <div style={styles.actions}>
                    <button style={styles.editBtn} onClick={() => openEdit(card)}>Edit</button>
                    <button style={styles.manageBtn} onClick={() => openCountries(card)}>Countries</button>
                    <button style={styles.toggleBtn} onClick={() => handleToggleCard(card)}>
                      {card.is_active ? 'Deactivate' : 'Activate'}
                    </button>
                    <span style={styles.dragHandle}>⠿</span>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Add/Edit Card Modal */}
      {showCardModal && (
        <>
          <div style={styles.modalOverlay} onClick={() => setShowCardModal(false)} />
          <div style={styles.modal}>
            <p style={styles.modalTitle}>{editCard ? 'Edit Card Brand' : 'Add Card Brand'}</p>

            <div style={styles.fieldGroup}>
              <label style={styles.fieldLabel}>CARD NAME</label>
              <input style={styles.input} value={cardName} onChange={(e) => setCardName(e.target.value)} />
            </div>

            <div style={styles.fieldGroup}>
              <label style={styles.fieldLabel}>LOGO</label>
              <div
                style={styles.uploadBox}
                onClick={() => fileInputRef.current?.click()}
              >
                {logoPreview ? (
                  <img src={logoPreview} alt="Logo preview" style={styles.logoPreview} />
                ) : (
                  <>
                    <svg width={24} height={24} viewBox="0 0 24 24" fill="none" stroke="#888888" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
                      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                      <polyline points="17 8 12 3 7 8" />
                      <line x1={12} y1={3} x2={12} y2={15} />
                    </svg>
                    <span style={styles.uploadText}>{uploading ? 'Uploading...' : 'Upload Logo'}</span>
                  </>
                )}
              </div>
              <input ref={fileInputRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={handleLogoUpload} />
            </div>

            <div style={styles.fieldGroup}>
              <label style={styles.fieldLabel}>ACTIVE</label>
              <div style={{ ...styles.toggle, backgroundColor: cardActive ? '#111111' : '#E0E0E0' }} onClick={() => setCardActive(!cardActive)}>
                <div style={{ ...styles.toggleThumb, left: cardActive ? 22 : 2 }} />
              </div>
            </div>

            {cardError && <p style={styles.formError}>{cardError}</p>}

            <div style={styles.modalActions}>
              <button style={styles.cancelBtn} onClick={() => setShowCardModal(false)}>Cancel</button>
              <button style={styles.saveBtn} onClick={handleSaveCard} disabled={saving}>
                {saving ? 'Saving...' : 'Save'}
              </button>
            </div>
          </div>
        </>
      )}

      {/* Manage Countries Panel */}
      {countriesCard && (
        <>
          <div style={styles.panelOverlay} onClick={() => setCountriesCard(null)} />
          <div style={styles.panel}>
            <p style={styles.panelTitle}>{countriesCard.name} — Countries</p>

            {/* Existing countries */}
            <div style={styles.countriesList}>
              {countriesCard.countries.length === 0 && (
                <p style={{ fontSize: 12, color: '#888888' }}>No countries added yet.</p>
              )}
              {countriesCard.countries.map((country) => (
                <div key={country.id} style={styles.countryRow}>
                  <div style={{ flex: 1 }}>
                    <span style={styles.countryName}>{country.country_name}</span>
                    <span style={styles.currencySymbol}> ({country.currency_symbol})</span>
                  </div>
                  <div
                    style={{ ...styles.toggle, backgroundColor: country.is_active ? '#111111' : '#E0E0E0' }}
                    onClick={() => handleToggleCountry(country)}
                  >
                    <div style={{ ...styles.toggleThumb, left: country.is_active ? 22 : 2 }} />
                  </div>
                  <button style={styles.removeBtn} onClick={() => handleRemoveCountry(country)}>Remove</button>
                </div>
              ))}
            </div>

            {/* Add country form */}
            <p style={{ ...styles.fieldLabel, marginTop: 16 }}>+ ADD COUNTRY</p>

            <div style={styles.fieldGroup}>
              <label style={styles.fieldLabel}>COUNTRY</label>
              <select style={styles.input} value={newCountryCode} onChange={(e) => setNewCountryCode(e.target.value)}>
                <option value="">Select country</option>
                {ISO_COUNTRIES.map((c) => (
                  <option key={c.code} value={c.code}>{c.name}</option>
                ))}
              </select>
            </div>

            <div style={styles.fieldGroup}>
              <label style={styles.fieldLabel}>CURRENCY SYMBOL (max 3)</label>
              <input style={styles.input} maxLength={3} placeholder="e.g. $" value={newCurrencySymbol} onChange={(e) => setNewCurrencySymbol(e.target.value)} />
            </div>

            <div style={styles.fieldGroup}>
              <label style={styles.fieldLabel}>CURRENCY NAME</label>
              <input style={styles.input} placeholder="e.g. US Dollar" value={newCurrencyName} onChange={(e) => setNewCurrencyName(e.target.value)} />
            </div>

            <div style={styles.fieldGroup}>
              <label style={styles.fieldLabel}>ACTIVE</label>
              <div style={{ ...styles.toggle, backgroundColor: newCountryActive ? '#111111' : '#E0E0E0' }} onClick={() => setNewCountryActive(!newCountryActive)}>
                <div style={{ ...styles.toggleThumb, left: newCountryActive ? 22 : 2 }} />
              </div>
            </div>

            <button
              style={{ ...styles.saveBtn, width: '100%', marginTop: 8, opacity: (!newCountryCode || !newCurrencySymbol || !newCurrencyName) ? 0.5 : 1 }}
              onClick={handleAddCountry}
              disabled={!newCountryCode || !newCurrencySymbol || !newCurrencyName || addingCountry}
            >
              {addingCountry ? 'Adding...' : 'Add Country'}
            </button>
          </div>
        </>
      )}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  page: { position: 'relative' },
  header: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 },
  title: { fontSize: 15, fontWeight: 800, color: '#111111' },
  createBtn: { backgroundColor: '#111111', color: '#FFFFFF', border: 'none', borderRadius: 100, padding: '8px 18px', fontSize: 12, fontWeight: 700, cursor: 'pointer' },
  tableWrapper: { overflowX: 'auto', borderRadius: 10, border: '1px solid #EEEEEE' },
  table: { width: '100%', borderCollapse: 'collapse', fontSize: 12 },
  th: { backgroundColor: '#111111', color: '#FFFFFF', fontSize: 12, fontWeight: 700, padding: '10px 12px', textAlign: 'left', whiteSpace: 'nowrap' },
  td: { padding: '10px 12px', color: '#333333', fontSize: 12, verticalAlign: 'middle' },
  logoThumb: { width: 32, height: 32, objectFit: 'contain', borderRadius: 4 },
  logoPlaceholder: { width: 32, height: 32, backgroundColor: '#F0F0F0', borderRadius: 4 },
  badgeActive: { backgroundColor: '#E8F5E9', color: '#2E7D32', padding: '3px 8px', borderRadius: 100, fontSize: 11, fontWeight: 600 },
  badgeInactive: { backgroundColor: '#EBEBEB', color: '#888888', padding: '3px 8px', borderRadius: 100, fontSize: 11, fontWeight: 600 },
  actions: { display: 'flex', gap: 6, alignItems: 'center' },
  editBtn: { backgroundColor: '#F3E5F5', color: '#6A1B9A', border: 'none', borderRadius: 6, padding: '4px 10px', fontSize: 11, fontWeight: 600, cursor: 'pointer' },
  manageBtn: { backgroundColor: '#E3F2FD', color: '#1565C0', border: 'none', borderRadius: 6, padding: '4px 10px', fontSize: 11, fontWeight: 600, cursor: 'pointer' },
  toggleBtn: { backgroundColor: '#FFF8E1', color: '#F9A825', border: 'none', borderRadius: 6, padding: '4px 10px', fontSize: 11, fontWeight: 600, cursor: 'pointer' },
  dragHandle: { fontSize: 16, color: '#CCCCCC', cursor: 'grab', userSelect: 'none' },
  modalOverlay: { position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.4)', zIndex: 49 },
  modal: { position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%,-50%)', backgroundColor: '#FFFFFF', borderRadius: 12, padding: 24, width: 480, zIndex: 50, maxHeight: '90vh', overflowY: 'auto' },
  modalTitle: { fontSize: 15, fontWeight: 800, color: '#111111', margin: '0 0 20px' },
  fieldGroup: { marginBottom: 14 },
  fieldLabel: { display: 'block', fontSize: 11, fontWeight: 600, color: '#888888', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 4 },
  input: { width: '100%', border: '1.5px solid #E8E8E8', borderRadius: 8, padding: '10px 14px', fontSize: 13, color: '#111111', outline: 'none', boxSizing: 'border-box', backgroundColor: '#FFFFFF' },
  uploadBox: { width: 100, height: 100, border: '2px dashed #DEDEDE', borderRadius: 8, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', gap: 6 },
  uploadText: { fontSize: 11, color: '#888888' },
  logoPreview: { width: 96, height: 96, objectFit: 'contain', borderRadius: 6 },
  toggle: { width: 44, height: 24, borderRadius: 100, position: 'relative', cursor: 'pointer', transition: 'background-color 0.25s', flexShrink: 0 },
  toggleThumb: { position: 'absolute', top: 2, width: 20, height: 20, borderRadius: '50%', backgroundColor: '#FFFFFF', boxShadow: '0 1px 3px rgba(0,0,0,0.2)', transition: 'left 0.25s' },
  formError: { fontSize: 12, color: '#E53935', margin: '8px 0' },
  modalActions: { display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 16 },
  cancelBtn: { backgroundColor: '#F7F7F7', color: '#333333', border: 'none', borderRadius: 8, padding: '8px 20px', fontSize: 13, fontWeight: 600, cursor: 'pointer' },
  saveBtn: { backgroundColor: '#111111', color: '#FFFFFF', border: 'none', borderRadius: 100, padding: '8px 20px', fontSize: 12, fontWeight: 700, cursor: 'pointer' },
  panelOverlay: { position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.2)', zIndex: 49 },
  panel: { position: 'fixed', top: 0, right: 0, bottom: 0, width: 440, backgroundColor: '#FFFFFF', borderLeft: '1px solid #EEEEEE', padding: 24, zIndex: 50, overflowY: 'auto' },
  panelTitle: { fontSize: 15, fontWeight: 800, color: '#111111', margin: '0 0 16px' },
  countriesList: { display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 8 },
  countryRow: { display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0', borderBottom: '1px solid #F0F0F0' },
  countryName: { fontSize: 13, fontWeight: 600, color: '#111111' },
  currencySymbol: { fontSize: 12, color: '#888888' },
  removeBtn: { backgroundColor: '#FFEBEE', color: '#C62828', border: 'none', borderRadius: 6, padding: '4px 10px', fontSize: 11, fontWeight: 600, cursor: 'pointer' },
};
