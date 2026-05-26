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

interface InstalledCountry {
  id: string;
  country_code: string;
  is_active: boolean;
}

interface AvailableCountry {
  country_code: string;
  country_name: string;
  is_active: boolean;
}

interface Template {
  id: string;
  name: string;
  is_active: boolean;
  sort_order: number;
  fields: Field[];
  countries: InstalledCountry[];
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
  const [templates, setTemplates] = useState<Template[]>([]);
  const [countries, setCountries] = useState<AvailableCountry[]>([]);
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

  const [busyCountry, setBusyCountry] = useState<string | null>(null);

  useEffect(() => { fetchCards(); }, []);

  const fetchCards = async () => {
    const res = await fetch('/api/cards');
    const data = await res.json();
    setCards(data.cards || []);
  };

  const fetchTemplates = async (cardId: string, silent = false) => {
    if (!silent) setLoading(true);
    const res = await fetch(`/api/field-builder?card_id=${cardId}`);
    const data = await res.json();
    setTemplates((data.templates || []).map((t: Template) => ({ ...t, expanded: false })));
    setCountries(data.countries || []);
    if (!silent) setLoading(false);
  };

  const selectCard = (card: CardBrand) => {
    setSelectedCard(card);
    setTemplates([]);
    setCountries([]);
    fetchTemplates(card.id);
  };

  const refresh = () => { if (selectedCard) fetchTemplates(selectedCard.id, true); };

  const toggleExpand = (id: string) => {
    setTemplates((prev) => prev.map((t) => t.id === id ? { ...t, expanded: !t.expanded } : t));
  };

  const countryName = (code: string) => countries.find((c) => c.country_code === code)?.country_name || code;

  const handleAddType = async () => {
    if (!newTypeName.trim() || !selectedCard) return;
    setSavingType(true);
    await fetch('/api/field-builder', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'template', card_id: selectedCard.id, name: newTypeName.trim() }),
    });
    setSavingType(false);
    setNewTypeName(''); setShowAddType(false);
    refresh();
  };

  const handleToggleType = async (tpl: Template) => {
    await fetch('/api/field-builder', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'template', id: tpl.id, is_active: !tpl.is_active }),
    });
    refresh();
  };

  const handleSaveEditType = async (id: string) => {
    if (!editTypeName.trim()) return;
    await fetch('/api/field-builder', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'template', id, name: editTypeName.trim() }),
    });
    setEditTypeId(null);
    refresh();
  };

  const confirmDeleteType = async () => {
    if (!deleteTypeId) return;
    await fetch('/api/field-builder', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'template', id: deleteTypeId }),
    });
    setDeleteTypeId(null);
    refresh();
  };

  const addToCountry = async (templateId: string, countryCode: string) => {
    setBusyCountry(`${templateId}:${countryCode}`);
    await fetch('/api/field-builder', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'add_country', template_id: templateId, country_code: countryCode }),
    });
    setBusyCountry(null);
    refresh();
  };

  const toggleCountry = async (cardTypeId: string, isActive: boolean) => {
    setBusyCountry(cardTypeId);
    await fetch('/api/field-builder', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'country', card_type_id: cardTypeId, is_active: isActive }),
    });
    setBusyCountry(null);
    refresh();
  };

  const openAddField = (templateId: string) => {
    setFieldFormTypeId(templateId); setFieldFormMode('add');
    setEditFieldId(null); setFieldLabel(''); setFieldInputType('text'); setFieldRequired(true);
  };

  const openEditField = (templateId: string, field: Field) => {
    setFieldFormTypeId(templateId); setFieldFormMode('edit');
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
        body: JSON.stringify({ type: 'field', template_id: fieldFormTypeId, label: fieldLabel.trim(), input_type: fieldInputType, is_required: fieldRequired }),
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
    refresh();
  };

  const handleDeleteField = async (fieldId: string) => {
    await fetch('/api/field-builder', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'field', id: fieldId }),
    });
    refresh();
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

      <div style={styles.panel3}>
        {!selectedCard ? (
          <p style={styles.emptyText}>Select a card</p>
        ) : (
          <>
            <div style={styles.panel3Header}>
              <span style={styles.panel3Title}>{selectedCard.name} — Card Types</span>
              <button style={styles.addTypeBtn} onClick={() => setShowAddType(true)}>+ Add Card Type</button>
            </div>
            <p style={styles.hintText}>Create a card type once (with its fields), then add it to each country below.</p>

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

            {templates.map((tpl) => {
              const installedCodes = new Set(tpl.countries.map((c) => c.country_code));
              const notAdded = countries.filter((c) => !installedCodes.has(c.country_code));
              return (
                <div key={tpl.id} style={styles.typeBlock}>
                  <div style={styles.typeHeader}>
                    {editTypeId === tpl.id ? (
                      <>
                        <input
                          style={{ ...styles.inlineInput, flex: 1 }}
                          value={editTypeName}
                          onChange={(e) => setEditTypeName(e.target.value)}
                          autoFocus
                        />
                        <button style={styles.saveSmallBtn} onClick={() => handleSaveEditType(tpl.id)}>Save</button>
                        <button style={styles.cancelSmallBtn} onClick={() => setEditTypeId(null)}>Cancel</button>
                      </>
                    ) : (
                      <>
                        <span style={styles.typeName}>{tpl.name}</span>
                        <span style={styles.countCount}>{tpl.countries.filter((c) => c.is_active).length} {tpl.countries.filter((c) => c.is_active).length === 1 ? 'country' : 'countries'}</span>
                        <div
                          style={{ ...styles.toggle, backgroundColor: tpl.is_active ? 'var(--accent-base)' : 'var(--bg-muted)' }}
                          onClick={() => handleToggleType(tpl)}
                        >
                          <div style={{ ...styles.toggleThumb, left: tpl.is_active ? 22 : 2 }} />
                        </div>
                        <button style={styles.iconBtn} onClick={() => { setEditTypeId(tpl.id); setEditTypeName(tpl.name); }}><EditIcon /></button>
                        <button style={styles.iconBtnRed} onClick={() => setDeleteTypeId(tpl.id)}><DeleteIcon /></button>
                        <button style={styles.expandBtn} onClick={() => toggleExpand(tpl.id)}>{tpl.expanded ? '▲' : '▼'}</button>
                      </>
                    )}
                  </div>

                  {tpl.expanded && (
                    <div style={styles.body}>
                      <p style={styles.sectionLabel}>Countries</p>
                      <div style={styles.chipsWrap}>
                        {tpl.countries.length === 0 && <span style={styles.emptyInline}>Not added to any country yet.</span>}
                        {tpl.countries.map((c) => (
                          <div
                            key={c.id}
                            style={{ ...styles.chip, ...(c.is_active ? styles.chipOn : styles.chipOff) }}
                            onClick={() => busyCountry !== c.id && toggleCountry(c.id, !c.is_active)}
                            title={c.is_active ? 'Active — click to disable' : 'Disabled — click to enable'}
                          >
                            {c.is_active ? '● ' : '○ '}{countryName(c.country_code)}
                          </div>
                        ))}
                      </div>
                      {notAdded.length > 0 && (
                        <div style={styles.addWrap}>
                          <span style={styles.addLabel}>Add to:</span>
                          {notAdded.map((c) => (
                            <button
                              key={c.country_code}
                              style={styles.chipAdd}
                              disabled={busyCountry === `${tpl.id}:${c.country_code}`}
                              onClick={() => addToCountry(tpl.id, c.country_code)}
                            >
                              + {c.country_name}
                            </button>
                          ))}
                        </div>
                      )}

                      <p style={{ ...styles.sectionLabel, marginTop: 14 }}>Fields</p>
                      <div style={styles.fieldsBlock}>
                        {tpl.fields.map((field) => (
                          <div key={field.id}>
                            {fieldFormTypeId === tpl.id && fieldFormMode === 'edit' && editFieldId === field.id ? (
                              <FieldForm
                                label={fieldLabel} setLabel={setFieldLabel}
                                inputType={fieldInputType} setInputType={setFieldInputType}
                                required={fieldRequired} setRequired={setFieldRequired}
                                onSave={handleSaveField} onCancel={() => setFieldFormTypeId(null)}
                                saving={savingField}
                              />
                            ) : (
                              <div style={styles.fieldRow}>
                                <span style={styles.fieldLabel}>{field.label}</span>
                                <span style={styles.inputTypeBadge}>{inputTypeBadge(field.input_type)}</span>
                                <span style={field.is_required ? styles.requiredBadge : styles.optionalBadge}>
                                  {field.is_required ? 'Required' : 'Optional'}
                                </span>
                                <button style={styles.iconBtn} onClick={() => openEditField(tpl.id, field)}><EditIcon /></button>
                                <button style={styles.iconBtnRed} onClick={() => handleDeleteField(field.id)}><DeleteIcon /></button>
                              </div>
                            )}
                          </div>
                        ))}

                        {fieldFormTypeId === tpl.id && fieldFormMode === 'add' ? (
                          <FieldForm
                            label={fieldLabel} setLabel={setFieldLabel}
                            inputType={fieldInputType} setInputType={setFieldInputType}
                            required={fieldRequired} setRequired={setFieldRequired}
                            onSave={handleSaveField} onCancel={() => setFieldFormTypeId(null)}
                            saving={savingField}
                          />
                        ) : (
                          <button style={styles.addFieldBtn} onClick={() => openAddField(tpl.id)}>+ Add Field</button>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}

            {!loading && templates.length === 0 && (
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
            <p style={styles.modalText}>This deletes the card type and its fields. Countries already added keep working (they just unlink from this template). This cannot be undone.</p>
            <div style={styles.modalActions}>
              <button style={styles.cancelSmallBtn} onClick={() => setDeleteTypeId(null)}>Cancel</button>
              <button style={{ ...styles.saveSmallBtn, backgroundColor: 'var(--tone-danger-fg)' }} onClick={confirmDeleteType}>Delete</button>
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
        <div style={{ ...styles.toggle, backgroundColor: required ? 'var(--accent-base)' : 'var(--bg-muted)' }} onClick={() => setRequired(!required)}>
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
  panel1: { width: 200, backgroundColor: 'var(--bg-surface)', borderRight: '1px solid var(--border-default)', overflowY: 'auto', flexShrink: 0 },
  panel3: { flex: 1, overflowY: 'auto', padding: 20, backgroundColor: 'var(--bg-surface)' },
  panelHeader: { fontSize: 11, fontWeight: 700, color: 'var(--fg-tertiary)', textTransform: 'uppercase', letterSpacing: '0.04em', padding: '12px 14px 8px', margin: 0, borderBottom: '1px solid var(--border-default)' },
  panelItem: { display: 'flex', alignItems: 'center', gap: 8, padding: '9px 14px', cursor: 'pointer', fontSize: 12, fontWeight: 600, color: 'var(--fg-secondary)' },
  panelItemActive: { backgroundColor: 'var(--bg-subtle)', borderLeft: '2.5px solid var(--accent-base)', paddingLeft: 11.5, color: 'var(--fg-primary)' },
  panelItemLabel: { fontSize: 12, fontWeight: 600 },
  cardLogo: { width: 24, height: 24, objectFit: 'contain', borderRadius: 3, flexShrink: 0 },
  emptyText: { fontSize: 12, color: 'var(--fg-tertiary)', padding: '12px 14px', margin: 0 },
  emptyInline: { fontSize: 12, color: 'var(--fg-tertiary)' },
  hintText: { fontSize: 12, color: 'var(--fg-tertiary)', margin: '0 0 14px' },
  panel3Header: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 },
  panel3Title: { fontSize: 14, fontWeight: 700, color: 'var(--fg-primary)' },
  addTypeBtn: { backgroundColor: 'var(--accent-base)', color: 'var(--accent-fg)', border: 'none', borderRadius: 100, padding: '6px 14px', fontSize: 12, fontWeight: 700, cursor: 'pointer' },
  inlineForm: { display: 'flex', gap: 8, alignItems: 'center', marginBottom: 12, backgroundColor: 'var(--bg-subtle)', padding: 10, borderRadius: 8 },
  inlineInput: { border: '1.5px solid var(--border-default)', borderRadius: 6, padding: '6px 10px', fontSize: 12, color: 'var(--fg-primary)', outline: 'none', backgroundColor: 'var(--bg-surface)' },
  saveSmallBtn: { backgroundColor: 'var(--accent-base)', color: 'var(--accent-fg)', border: 'none', borderRadius: 6, padding: '6px 12px', fontSize: 11, fontWeight: 700, cursor: 'pointer' },
  cancelSmallBtn: { backgroundColor: 'var(--bg-subtle)', color: 'var(--fg-secondary)', border: 'none', borderRadius: 6, padding: '6px 12px', fontSize: 11, fontWeight: 600, cursor: 'pointer' },
  typeBlock: { border: '1px solid var(--border-default)', borderRadius: 8, marginBottom: 10, overflow: 'hidden' },
  typeHeader: { display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', backgroundColor: 'var(--bg-subtle)' },
  typeName: { fontSize: 12, fontWeight: 600, color: 'var(--fg-primary)' },
  countCount: { fontSize: 11, color: 'var(--fg-tertiary)', flex: 1 },
  toggle: { width: 44, height: 24, borderRadius: 100, position: 'relative', cursor: 'pointer', transition: 'background-color 0.25s', flexShrink: 0 },
  toggleThumb: { position: 'absolute', top: 2, width: 20, height: 20, borderRadius: '50%', backgroundColor: 'var(--bg-surface)', boxShadow: '0 1px 3px rgba(0,0,0,0.2)', transition: 'left 0.25s' },
  iconBtn: { background: 'none', border: 'none', cursor: 'pointer', color: 'var(--fg-tertiary)', padding: 4, display: 'flex', alignItems: 'center' },
  iconBtnRed: { background: 'none', border: 'none', cursor: 'pointer', color: 'var(--tone-danger-fg)', padding: 4, display: 'flex', alignItems: 'center' },
  expandBtn: { background: 'none', border: 'none', cursor: 'pointer', fontSize: 10, color: 'var(--fg-tertiary)', padding: 4 },
  body: { padding: '12px 14px 14px', borderTop: '1px solid var(--border-default)' },
  sectionLabel: { fontSize: 11, fontWeight: 700, color: 'var(--fg-tertiary)', textTransform: 'uppercase', letterSpacing: '0.04em', margin: '0 0 8px' },
  chipsWrap: { display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' },
  chip: { padding: '4px 10px', borderRadius: 100, fontSize: 11, fontWeight: 600, cursor: 'pointer', userSelect: 'none' },
  chipOn: { backgroundColor: 'var(--tone-success-bg)', color: 'var(--tone-success-fg)' },
  chipOff: { backgroundColor: 'var(--tone-neutral-bg)', color: 'var(--tone-neutral-fg)' },
  addWrap: { display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center', marginTop: 8 },
  addLabel: { fontSize: 11, color: 'var(--fg-tertiary)', fontWeight: 600 },
  chipAdd: { padding: '4px 10px', borderRadius: 100, fontSize: 11, fontWeight: 600, cursor: 'pointer', border: '1px dashed var(--border-default)', backgroundColor: 'var(--bg-surface)', color: 'var(--fg-secondary)' },
  fieldsBlock: { },
  fieldRow: { display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0', borderBottom: '1px solid var(--border-subtle)' },
  fieldLabel: { fontSize: 12, color: 'var(--fg-secondary)', flex: 1 },
  inputTypeBadge: { backgroundColor: 'var(--tone-info-bg)', color: 'var(--tone-info-fg)', padding: '2px 8px', borderRadius: 100, fontSize: 11, fontWeight: 600, whiteSpace: 'nowrap' },
  requiredBadge: { backgroundColor: 'var(--tone-danger-bg)', color: 'var(--tone-danger-fg)', padding: '2px 8px', borderRadius: 100, fontSize: 11, fontWeight: 600 },
  optionalBadge: { backgroundColor: 'var(--tone-neutral-bg)', color: 'var(--tone-neutral-fg)', padding: '2px 8px', borderRadius: 100, fontSize: 11, fontWeight: 600 },
  addFieldBtn: { background: 'none', border: 'none', cursor: 'pointer', fontSize: 11, fontWeight: 600, color: 'var(--tone-success-fg)', padding: '6px 0', marginTop: 4 },
  fieldForm: { backgroundColor: 'var(--bg-subtle)', borderRadius: 8, padding: 12, marginBottom: 8 },
  fieldFormRow: { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 },
  fieldFormLabel: { fontSize: 12, color: 'var(--fg-secondary)', fontWeight: 600 },
  typePill: { borderWidth: '1.5px', borderStyle: 'solid', borderColor: 'var(--border-default)', borderRadius: 100, padding: '6px 14px', fontSize: 12, cursor: 'pointer', backgroundColor: 'var(--bg-surface)', color: 'var(--fg-secondary)', fontWeight: 500 },
  typePillActive: { backgroundColor: 'var(--accent-base)', color: 'var(--accent-fg)', borderColor: 'var(--accent-base)' },
  modalOverlay: { position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.4)', zIndex: 99 },
  modal: { position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%,-50%)', backgroundColor: 'var(--bg-surface)', borderRadius: 12, padding: 24, width: 360, zIndex: 100 },
  modalTitle: { fontSize: 15, fontWeight: 800, color: 'var(--fg-primary)', margin: '0 0 8px' },
  modalText: { fontSize: 13, color: 'var(--fg-secondary)', margin: '0 0 16px' },
  modalActions: { display: 'flex', gap: 10, justifyContent: 'flex-end' },
};
