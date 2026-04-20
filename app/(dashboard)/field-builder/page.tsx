'use client';

import { useEffect, useState } from 'react';

interface CardBrand {
  id: string;
  name: string;
  logo_url: string | null;
  countries: { country_code: string; country_name: string; is_active: boolean }[];
}

interface Field {
  id: string;
  label: string;
  input_type: 'text' | 'image' | 'image_text';
  is_required: boolean;
  sort_order: number;
}

interface CardType {
  id: string;
  name: string;
  is_active: boolean;
  sort_order: number;
  fields: Field[];
  expanded?: boolean;
}

const INPUT_TYPE_OPTIONS = [
  { value: 'text', label: 'Text' },
  { value: 'image', label: 'Image Upload' },
  { value: 'image_text', label: 'Image + Text' },
];

export default function FieldBuilderPage() {
  const [cards, setCards] = useState<CardBrand[]>([]);
  const [selectedCard, setSelectedCard] = useState<CardBrand | null>(null);
  const [selectedCountry, setSelectedCountry] = useState<{ country_code: string; country_name: string } | null>(null);
  const [cardTypes, setCardTypes] = useState<CardType[]>([]);
  const [loading, setLoading] = useState(false);

  const [showAddType, setShowAddType] = useState(false);
  const [newTypeName, setNewTypeName] = useState('');
  const [savingType, setSavingType] = useState(false);

  const [editTypeId, setEditTypeId] = useState<string | null>(null);
  const [editTypeName, setEditTypeName] = useState('');

  const [deleteTypeId, setDeleteTypeId] = useState<string | null>(null);
  const [fieldFormTypeId, setFieldFormTypeId] = useState<string | null>(null);
  const [fieldFormMode, setFieldFormMode] = useState<'add' | 'edit'>('add');
  const [editFieldId, setEditFieldId] = useState<string | null>(null);
  const [fieldLabel, setFieldLabel] = useState('');
  const [fieldInputType, setFieldInputType] = useState<'text' | 'image' | 'image_text'>('text');
  const [fieldRequired, setFieldRequired] = useState(true);
  const [savingField, setSavingField] = useState(false);

  useEffect(() => { fetchCards(); }, []);

  const fetchCards = async () => {
    const res = await fetch('/api/cards');
    const data = await res.json();
    setCards(data.cards || []);
  };

  const fetchTypes = async (cardId: string, countryCode: string) => {
    setLoading(true);
    const res = await fetch(`/api/field-builder?card_id=${cardId}&country_code=${countryCode}`);
    const data = await res.json();
    setCardTypes((data.types || []).map((t: CardType) => ({ ...t, expanded: false })));
    setLoading(false);
  };

  const selectCard = (card: CardBrand) => {
    setSelectedCard(card);
    setSelectedCountry(null);
    setCardTypes([]);
  };

  const selectCountry = (country: { country_code: string; country_name: string }) => {
    setSelectedCountry(country);
    if (selectedCard) fetchTypes(selectedCard.id, country.country_code);
  };

  const toggleExpand = (typeId: string) => {
    setCardTypes((prev) => prev.map((t) => t.id === typeId ? { ...t, expanded: !t.expanded } : t));
  };

  const handleAddType = async () => {
    if (!newTypeName.trim() || !selectedCard || !selectedCountry) return;
    setSavingType(true);
    await fetch('/api/field-builder', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'card_type', card_id: selectedCard.id, country_code: selectedCountry.country_code, name: newTypeName.trim() }),
    });
    setSavingType(false);
    setNewTypeName(''); setShowAddType(false);
    fetchTypes(selectedCard.id, selectedCountry.country_code);
  };

  const handleToggleType = async (cardType: CardType) => {
    await fetch('/api/field-builder', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'card_type', id: cardType.id, is_active: !cardType.is_active }),
    });
    fetchTypes(selectedCard!.id, selectedCountry!.country_code);
  };

  const handleSaveEditType = async (typeId: string) => {
    if (!editTypeName.trim()) return;
    await fetch('/api/field-builder', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'card_type', id: typeId, name: editTypeName.trim() }),
    });
    setEditTypeId(null);
    fetchTypes(selectedCard!.id, selectedCountry!.country_code);
  };

  const handleDeleteType = async (typeId: string) => {
    setDeleteTypeId(typeId);
  };

  const confirmDeleteType = async () => {
    if (!deleteTypeId) return;
    await fetch('/api/field-builder', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'card_type', id: deleteTypeId }),
    });
    setDeleteTypeId(null);
    fetchTypes(selectedCard!.id, selectedCountry!.country_code);
  };

  const openAddField = (typeId: string) => {
    setFieldFormTypeId(typeId); setFieldFormMode('add');
    setEditFieldId(null); setFieldLabel(''); setFieldInputType('text'); setFieldRequired(true);
  };

  const openEditField = (typeId: string, field: Field) => {
    setFieldFormTypeId(typeId); setFieldFormMode('edit');
    setEditFieldId(field.id); setFieldLabel(field.label);
    setFieldInputType(field.input_type); setFieldRequired(field.is_required);
  };

  const handleSaveField = async () => {
    if (!fieldLabel.trim()) return;
    setSavingField(true);
    if (fieldFormMode === 'add') {
      await fetch('/api/field-builder', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'field', card_type_id: fieldFormTypeId, label: fieldLabel.trim(), input_type: fieldInputType, is_required: fieldRequired }),
      });
    } else {
      await fetch('/api/field-builder', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'field', id: editFieldId, label: fieldLabel.trim(), input_type: fieldInputType, is_required: fieldRequired }),
      });
    }
    setSavingField(false);
    setFieldFormTypeId(null);
    fetchTypes(selectedCard!.id, selectedCountry!.country_code);
  };

  const handleDeleteField = async (fieldId: string) => {
    await fetch('/api/field-builder', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'field', id: fieldId }),
    });
    fetchTypes(selectedCard!.id, selectedCountry!.country_code);
  };

  const inputTypeBadge = (type: string) => {
    const map: Record<string, string> = { text: 'Text', image: 'Image Upload', image_text: 'Image + Text' };
    return map[type] || type;
  };

  return (
    <div style={styles.container}>
      <div style={styles.panel1}>
        <p style={styles.panelHeader}>Card Brands</p>
        {cards.map((card) => (
          <div
            key={card.id}
            style={{ ...styles.panelItem, ...(selectedCard?.id === card.id ? styles.panelItemActive : {}) }}
            onClick={() => selectCard(card)}
          >
            {card.logo_url && <img src={card.logo_url} alt={card.name} style={styles.cardLogo} />}
            <span style={styles.panelItemLabel}>{card.name}</span>
          </div>
        ))}
        {cards.length === 0 && <p style={styles.emptyText}>No cards yet</p>}
      </div>

      <div style={styles.panel2}>
        <p style={styles.panelHeader}>Countries</p>
        {selectedCard ? (
          selectedCard.countries.filter((c) => c.is_active).map((country) => (
            <div
              key={country.country_code}
              style={{ ...styles.panelItem, ...(selectedCountry?.country_code === country.country_code ? styles.panelItemActive : {}) }}
              onClick={() => selectCountry(country)}
            >
              <span style={styles.panelItemLabel}>{country.country_name}</span>
            </div>
          ))
        ) : (
          <p style={styles.emptyText}>Select a card</p>
        )}
        {selectedCard && selectedCard.countries.filter((c) => c.is_active).length === 0 && (
          <p style={styles.emptyText}>No countries</p>
        )}
      </div>

      <div style={styles.panel3}>
        {!selectedCard || !selectedCountry ? (
          <p style={styles.emptyText}>Select a card and country</p>
        ) : (
          <>
            <div style={styles.panel3Header}>
              <span style={styles.panel3Title}>{selectedCard.name} — {selectedCountry.country_name}</span>
              <button style={styles.addTypeBtn} onClick={() => setShowAddType(true)}>+ Add Card Type</button>
            </div>

            {showAddType && (
              <div style={styles.inlineForm}>
                <input
                  style={styles.inlineInput}
                  placeholder="Card type name (e.g. E-code)"
                  value={newTypeName}
                  onChange={(e) => setNewTypeName(e.target.value)}
                  autoFocus
                />
                <button style={styles.saveSmallBtn} onClick={handleAddType} disabled={savingType}>
                  {savingType ? 'Saving...' : 'Save'}
                </button>
                <button style={styles.cancelSmallBtn} onClick={() => { setShowAddType(false); setNewTypeName(''); }}>Cancel</button>
              </div>
            )}

            {loading && <p style={styles.emptyText}>Loading...</p>}

            {cardTypes.map((cardType) => (
              <div key={cardType.id} style={styles.typeBlock}>
                <div style={styles.typeHeader}>
                  {editTypeId === cardType.id ? (
                    <>
                      <input
                        style={{ ...styles.inlineInput, flex: 1 }}
                        value={editTypeName}
                        onChange={(e) => setEditTypeName(e.target.value)}
                        autoFocus
                      />
                      <button style={styles.saveSmallBtn} onClick={() => handleSaveEditType(cardType.id)}>Save</button>
                      <button style={styles.cancelSmallBtn} onClick={() => setEditTypeId(null)}>Cancel</button>
                    </>
                  ) : (
                    <>
                      <span style={styles.typeName}>{cardType.name}</span>
                      <div
                        style={{ ...styles.toggle, backgroundColor: cardType.is_active ? '#111111' : '#E0E0E0' }}
                        onClick={() => handleToggleType(cardType)}
                      >
                        <div style={{ ...styles.toggleThumb, left: cardType.is_active ? 22 : 2 }} />
                      </div>
                      <button style={styles.iconBtn} onClick={() => { setEditTypeId(cardType.id); setEditTypeName(cardType.name); }}>
                        <EditIcon />
                      </button>
                      <button style={styles.iconBtnRed} onClick={() => handleDeleteType(cardType.id)}>
                        <DeleteIcon />
                      </button>
                      <button style={styles.expandBtn} onClick={() => toggleExpand(cardType.id)}>
                        {cardType.expanded ? '▲' : '▼'}
                      </button>
                    </>
                  )}
                </div>

                {cardType.expanded && (
                  <div style={styles.fieldsBlock}>
                    {cardType.fields.map((field) => (
                      <div key={field.id}>
                        {fieldFormTypeId === cardType.id && fieldFormMode === 'edit' && editFieldId === field.id ? (
                          <FieldForm
                            label={fieldLabel} setLabel={setFieldLabel}
                            inputType={fieldInputType} setInputType={setFieldInputType}
                            required={fieldRequired} setRequired={setFieldRequired}
                            onSave={handleSaveField} onCancel={() => setFieldFormTypeId(null)}
                            saving={savingField}
                          />
                        ) : (
                          <div style={styles.fieldRow}>
                            <span style={styles.dragHandle}>⠿</span>
                            <span style={styles.fieldLabel}>{field.label}</span>
                            <span style={styles.inputTypeBadge}>{inputTypeBadge(field.input_type)}</span>
                            <span style={field.is_required ? styles.requiredBadge : styles.optionalBadge}>
                              {field.is_required ? 'Required' : 'Optional'}
                            </span>
                            <button style={styles.iconBtn} onClick={() => openEditField(cardType.id, field)}><EditIcon /></button>
                            <button style={styles.iconBtnRed} onClick={() => handleDeleteField(field.id)}><DeleteIcon /></button>
                          </div>
                        )}
                      </div>
                    ))}

                    {fieldFormTypeId === cardType.id && fieldFormMode === 'add' ? (
                      <FieldForm
                        label={fieldLabel} setLabel={setFieldLabel}
                        inputType={fieldInputType} setInputType={setFieldInputType}
                        required={fieldRequired} setRequired={setFieldRequired}
                        onSave={handleSaveField} onCancel={() => setFieldFormTypeId(null)}
                        saving={savingField}
                      />
                    ) : (
                      <button style={styles.addFieldBtn} onClick={() => openAddField(cardType.id)}>+ Add Field</button>
                    )}
                  </div>
                )}
              </div>
            ))}

            {!loading && cardTypes.length === 0 && (
              <p style={styles.emptyText}>No card types yet. Add one above.</p>
            )}
          </>
        )}
      </div>
      {deleteTypeId && (
        <>
          <div style={styles.modalOverlay} />
          <div style={styles.modal}>
            <p style={styles.modalTitle}>Delete Card Type</p>
            <p style={styles.modalText}>This will delete the card type and all its fields. This cannot be undone.</p>
            <div style={styles.modalActions}>
              <button style={styles.cancelSmallBtn} onClick={() => setDeleteTypeId(null)}>Cancel</button>
              <button style={{ ...styles.saveSmallBtn, backgroundColor: '#C62828' }} onClick={confirmDeleteType}>Delete</button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function FieldForm({ label, setLabel, inputType, setInputType, required, setRequired, onSave, onCancel, saving }: {
  label: string; setLabel: (v: string) => void;
  inputType: 'text' | 'image' | 'image_text'; setInputType: (v: any) => void;
  required: boolean; setRequired: (v: boolean) => void;
  onSave: () => void; onCancel: () => void; saving: boolean;
}) {
  return (
    <div style={styles.fieldForm}>
      <div style={styles.fieldFormRow}>
        <input style={{ ...styles.inlineInput, flex: 1 }} placeholder="Field label" value={label} onChange={(e) => setLabel(e.target.value)} autoFocus />
      </div>
      <div style={styles.fieldFormRow}>
        {INPUT_TYPE_OPTIONS.map((opt) => (
          <button
            key={opt.value}
            style={{ ...styles.typePill, ...(inputType === opt.value ? styles.typePillActive : {}) }}
            onClick={() => setInputType(opt.value)}
          >
            {opt.label}
          </button>
        ))}
      </div>
      <div style={styles.fieldFormRow}>
        <span style={styles.fieldFormLabel}>Required</span>
        <div style={{ ...styles.toggle, backgroundColor: required ? '#111111' : '#E0E0E0' }} onClick={() => setRequired(!required)}>
          <div style={{ ...styles.toggleThumb, left: required ? 22 : 2 }} />
        </div>
      </div>
      <div style={styles.fieldFormRow}>
        <button style={styles.saveSmallBtn} onClick={onSave} disabled={saving}>{saving ? 'Saving...' : 'Save'}</button>
        <button style={styles.cancelSmallBtn} onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}

function EditIcon() {
  return (
    <svg width={13} height={13} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
      <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
    </svg>
  );
}

function DeleteIcon() {
  return (
    <svg width={13} height={13} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <polyline points="3 6 5 6 21 6" />
      <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
      <path d="M10 11v6M14 11v6" />
      <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
    </svg>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: { display: 'flex', height: 'calc(100vh - 48px)', overflow: 'hidden', margin: -24 },
  panel1: { width: 200, backgroundColor: '#FFFFFF', borderRight: '1px solid #EEEEEE', overflowY: 'auto', flexShrink: 0 },
  panel2: { width: 220, backgroundColor: '#F7F7F7', borderRight: '1px solid #EEEEEE', overflowY: 'auto', flexShrink: 0 },
  panel3: { flex: 1, overflowY: 'auto', padding: 20, backgroundColor: '#FFFFFF' },
  panelHeader: { fontSize: 11, fontWeight: 700, color: '#888888', textTransform: 'uppercase', letterSpacing: '0.04em', padding: '12px 14px 8px', margin: 0, borderBottom: '1px solid #EEEEEE' },
  panelItem: { display: 'flex', alignItems: 'center', gap: 8, padding: '9px 14px', cursor: 'pointer', fontSize: 12, fontWeight: 600, color: '#333333' },
  panelItemActive: { backgroundColor: '#F7F7F7', borderLeft: '2.5px solid #111111', paddingLeft: 11.5, color: '#111111' },
  panelItemLabel: { fontSize: 12, fontWeight: 600 },
  cardLogo: { width: 24, height: 24, objectFit: 'contain', borderRadius: 3, flexShrink: 0 },
  emptyText: { fontSize: 12, color: '#888888', padding: '12px 14px', margin: 0 },
  panel3Header: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 },
  panel3Title: { fontSize: 14, fontWeight: 700, color: '#111111' },
  addTypeBtn: { backgroundColor: '#111111', color: '#FFFFFF', border: 'none', borderRadius: 100, padding: '6px 14px', fontSize: 12, fontWeight: 700, cursor: 'pointer' },
  inlineForm: { display: 'flex', gap: 8, alignItems: 'center', marginBottom: 12, backgroundColor: '#F7F7F7', padding: 10, borderRadius: 8 },
  inlineInput: { border: '1.5px solid #E8E8E8', borderRadius: 6, padding: '6px 10px', fontSize: 12, color: '#111111', outline: 'none', backgroundColor: '#FFFFFF' },
  saveSmallBtn: { backgroundColor: '#111111', color: '#FFFFFF', border: 'none', borderRadius: 6, padding: '6px 12px', fontSize: 11, fontWeight: 700, cursor: 'pointer' },
  cancelSmallBtn: { backgroundColor: '#F0F0F0', color: '#555555', border: 'none', borderRadius: 6, padding: '6px 12px', fontSize: 11, fontWeight: 600, cursor: 'pointer' },
  typeBlock: { border: '1px solid #EEEEEE', borderRadius: 8, marginBottom: 10, overflow: 'hidden' },
  typeHeader: { display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', backgroundColor: '#FAFAFA' },
  typeName: { fontSize: 12, fontWeight: 600, color: '#111111', flex: 1 },
  toggle: { width: 44, height: 24, borderRadius: 100, position: 'relative', cursor: 'pointer', transition: 'background-color 0.25s', flexShrink: 0 },
  toggleThumb: { position: 'absolute', top: 2, width: 20, height: 20, borderRadius: '50%', backgroundColor: '#FFFFFF', boxShadow: '0 1px 3px rgba(0,0,0,0.2)', transition: 'left 0.25s' },
  iconBtn: { background: 'none', border: 'none', cursor: 'pointer', color: '#888888', padding: 4, display: 'flex', alignItems: 'center' },
  iconBtnRed: { background: 'none', border: 'none', cursor: 'pointer', color: '#E53935', padding: 4, display: 'flex', alignItems: 'center' },
  expandBtn: { background: 'none', border: 'none', cursor: 'pointer', fontSize: 10, color: '#888888', padding: 4 },
  fieldsBlock: { padding: '8px 14px 12px 30px', borderTop: '1px solid #EEEEEE' },
  fieldRow: { display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0', borderBottom: '1px solid #F5F5F5' },
  dragHandle: { fontSize: 14, color: '#CCCCCC', cursor: 'grab', userSelect: 'none' },
  fieldLabel: { fontSize: 12, color: '#333333', flex: 1 },
  inputTypeBadge: { backgroundColor: '#E3F2FD', color: '#1565C0', padding: '2px 8px', borderRadius: 100, fontSize: 11, fontWeight: 600, whiteSpace: 'nowrap' },
  requiredBadge: { backgroundColor: '#FFEBEE', color: '#C62828', padding: '2px 8px', borderRadius: 100, fontSize: 11, fontWeight: 600 },
  optionalBadge: { backgroundColor: '#F7F7F7', color: '#888888', padding: '2px 8px', borderRadius: 100, fontSize: 11, fontWeight: 600 },
  addFieldBtn: { background: 'none', border: 'none', cursor: 'pointer', fontSize: 11, fontWeight: 600, color: '#34C759', padding: '6px 0', marginTop: 4 },
  fieldForm: { backgroundColor: '#F7F7F7', borderRadius: 8, padding: 12, marginBottom: 8 },
  fieldFormRow: { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 },
  fieldFormLabel: { fontSize: 12, color: '#555555', fontWeight: 600 },
  typePill: { borderWidth: '1.5px', borderStyle: 'solid', borderColor: '#E8E8E8', borderRadius: 100, padding: '6px 14px', fontSize: 12, cursor: 'pointer', backgroundColor: '#FFFFFF', color: '#333333', fontWeight: 500 },
  typePillActive: { backgroundColor: '#111111', color: '#FFFFFF', borderColor: '#111111' },
  modalOverlay: { position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.4)', zIndex: 99 },
  modal: { position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%,-50%)', backgroundColor: '#FFFFFF', borderRadius: 12, padding: 24, width: 360, zIndex: 100 },
  modalTitle: { fontSize: 15, fontWeight: 800, color: '#111111', margin: '0 0 8px' },
  modalText: { fontSize: 13, color: '#555555', margin: '0 0 16px' },
  modalActions: { display: 'flex', gap: 10, justifyContent: 'flex-end' },
};
