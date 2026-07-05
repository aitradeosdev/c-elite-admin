'use client';

import { useEffect, useState } from 'react';
import { Pencil, Trash2, Plus, ChevronDown, ChevronUp } from 'lucide-react';
import { PageHeader, Card, CardHeader, CardBody, Button, Input, Toggle, Badge, Modal } from '../../_ui';

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

const sectionLabel: React.CSSProperties = {
  fontFamily: 'var(--font-mono)', fontSize: 10.5, fontWeight: 600, color: 'var(--fg-tertiary)',
  textTransform: 'uppercase', letterSpacing: '0.11em', margin: '0 0 8px',
};

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
    setTemplates((prev) => {
      const wasExpanded = new Map(prev.map((t) => [t.id, t.expanded]));
      return (data.templates || []).map((t: Template) => ({ ...t, expanded: wasExpanded.get(t.id) ?? false }));
    });
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
    <div>
      <PageHeader
        title="Field Builder"
        subtitle="Define card types and their input fields per brand, then roll them out country by country."
      />

      <div style={{ display: 'flex', gap: 'var(--space-4)', alignItems: 'flex-start', flexWrap: 'wrap' }}>
        <Card style={{ width: 220, flexShrink: 0 }}>
          <CardHeader title="Card Brands" />
          <CardBody flush>
            {cards.map((card) => {
              const active = selectedCard?.id === card.id;
              return (
                <button
                  key={card.id}
                  onClick={() => selectCard(card)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 8, width: '100%', textAlign: 'left',
                    padding: '9px 14px', cursor: 'pointer', border: 'none',
                    borderLeft: active ? '2.5px solid var(--accent-base)' : '2.5px solid transparent',
                    background: active ? 'var(--bg-subtle)' : 'transparent',
                    color: active ? 'var(--fg-primary)' : 'var(--fg-secondary)',
                    fontSize: 'var(--text-sm)', fontWeight: 600,
                  }}
                >
                  {card.logo_url && <img src={card.logo_url} alt={card.name} style={{ width: 24, height: 24, objectFit: 'contain', borderRadius: 3, flexShrink: 0 }} />}
                  <span>{card.name}</span>
                </button>
              );
            })}
            {cards.length === 0 && <p style={{ fontSize: 'var(--text-sm)', color: 'var(--fg-tertiary)', padding: '12px 14px', margin: 0 }}>No cards yet</p>}
          </CardBody>
        </Card>

        <div style={{ flex: 1, minWidth: 320 }}>
          {!selectedCard ? (
            <Card>
              <CardBody>
                <p style={{ fontSize: 'var(--text-md)', color: 'var(--fg-tertiary)', margin: 0 }}>Select a card brand to manage its card types.</p>
              </CardBody>
            </Card>
          ) : (
            <>
              <Card style={{ marginBottom: 'var(--space-4)' }}>
                <CardHeader
                  title={`${selectedCard.name} — Card Types`}
                  subtitle="Create a card type once (with its fields), then add it to each country below."
                  actions={
                    <Button variant="primary" size="sm" leftIcon={<Plus size={14} />} onClick={() => setShowAddType(true)}>
                      Add Card Type
                    </Button>
                  }
                />
                {showAddType && (
                  <CardBody>
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                      <Input
                        placeholder="Card type name (e.g. E-code)"
                        value={newTypeName}
                        onChange={(e) => setNewTypeName(e.target.value)}
                        autoFocus
                        style={{ flex: 1 }}
                      />
                      <Button variant="primary" size="sm" onClick={handleAddType} disabled={savingType} loading={savingType}>
                        {savingType ? 'Saving...' : 'Save'}
                      </Button>
                      <Button variant="secondary" size="sm" onClick={() => { setShowAddType(false); setNewTypeName(''); }}>Cancel</Button>
                    </div>
                  </CardBody>
                )}
              </Card>

              {loading && <p style={{ fontSize: 'var(--text-sm)', color: 'var(--fg-tertiary)', padding: '4px 2px', margin: 0 }}>Loading...</p>}

              {templates.map((tpl) => {
                const installedCodes = new Set(tpl.countries.map((c) => c.country_code));
                const notAdded = countries.filter((c) => !installedCodes.has(c.country_code));
                const activeCount = tpl.countries.filter((c) => c.is_active).length;
                return (
                  <Card key={tpl.id} style={{ marginBottom: 'var(--space-3)' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 16px' }}>
                      {editTypeId === tpl.id ? (
                        <>
                          <Input value={editTypeName} onChange={(e) => setEditTypeName(e.target.value)} autoFocus style={{ flex: 1 }} />
                          <Button variant="primary" size="sm" onClick={() => handleSaveEditType(tpl.id)}>Save</Button>
                          <Button variant="secondary" size="sm" onClick={() => setEditTypeId(null)}>Cancel</Button>
                        </>
                      ) : (
                        <>
                          <span style={{ fontSize: 'var(--text-md)', fontWeight: 600, color: 'var(--fg-primary)' }}>{tpl.name}</span>
                          <span style={{ fontSize: 'var(--text-xs)', color: 'var(--fg-tertiary)', flex: 1 }}>{activeCount} {activeCount === 1 ? 'country' : 'countries'}</span>
                          <Toggle checked={tpl.is_active} onChange={() => handleToggleType(tpl)} />
                          <Button iconOnly variant="ghost" size="sm" leftIcon={<Pencil size={14} />} onClick={() => { setEditTypeId(tpl.id); setEditTypeName(tpl.name); }} />
                          <Button iconOnly variant="dangerSubtle" size="sm" leftIcon={<Trash2 size={14} />} onClick={() => setDeleteTypeId(tpl.id)} />
                          <Button iconOnly variant="ghost" size="sm" leftIcon={tpl.expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />} onClick={() => toggleExpand(tpl.id)} />
                        </>
                      )}
                    </div>

                    {tpl.expanded && (
                      <CardBody style={{ borderTop: '1px solid var(--border-default)' }}>
                        <p style={sectionLabel}>Countries</p>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
                          {tpl.countries.length === 0 && <span style={{ fontSize: 'var(--text-sm)', color: 'var(--fg-tertiary)' }}>Not added to any country yet.</span>}
                          {tpl.countries.map((c) => (
                            <button
                              key={c.id}
                              onClick={() => busyCountry !== c.id && toggleCountry(c.id, !c.is_active)}
                              title={c.is_active ? 'Active — click to disable' : 'Disabled — click to enable'}
                              style={{
                                padding: '4px 10px', borderRadius: 'var(--radius-pill)', fontSize: 'var(--text-xs)', fontWeight: 600,
                                cursor: 'pointer', userSelect: 'none', border: '1px solid transparent',
                                background: c.is_active ? 'var(--tone-success-bg)' : 'var(--tone-neutral-bg)',
                                color: c.is_active ? 'var(--tone-success-fg)' : 'var(--tone-neutral-fg)',
                              }}
                            >
                              {c.is_active ? '● ' : '○ '}{countryName(c.country_code)}
                            </button>
                          ))}
                        </div>
                        {notAdded.length > 0 && (
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center', marginTop: 8 }}>
                            <span style={{ fontSize: 'var(--text-xs)', color: 'var(--fg-tertiary)', fontWeight: 600 }}>Add to:</span>
                            {notAdded.map((c) => (
                              <Button
                                key={c.country_code}
                                variant="secondary"
                                size="sm"
                                disabled={busyCountry === `${tpl.id}:${c.country_code}`}
                                onClick={() => addToCountry(tpl.id, c.country_code)}
                              >
                                + {c.country_name}
                              </Button>
                            ))}
                          </div>
                        )}

                        <p style={{ ...sectionLabel, marginTop: 16 }}>Fields</p>
                        <div>
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
                                <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 0', borderBottom: '1px solid var(--border-subtle)' }}>
                                  <span style={{ fontSize: 'var(--text-md)', color: 'var(--fg-secondary)', flex: 1 }}>{field.label}</span>
                                  <Badge tone="info">{inputTypeBadge(field.input_type)}</Badge>
                                  <Badge tone={field.is_required ? 'danger' : 'neutral'}>{field.is_required ? 'Required' : 'Optional'}</Badge>
                                  <Button iconOnly variant="ghost" size="sm" leftIcon={<Pencil size={14} />} onClick={() => openEditField(tpl.id, field)} />
                                  <Button iconOnly variant="dangerSubtle" size="sm" leftIcon={<Trash2 size={14} />} onClick={() => handleDeleteField(field.id)} />
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
                            <Button variant="ghost" size="sm" leftIcon={<Plus size={14} />} onClick={() => openAddField(tpl.id)} style={{ marginTop: 6 }}>
                              Add Field
                            </Button>
                          )}
                        </div>
                      </CardBody>
                    )}
                  </Card>
                );
              })}

              {!loading && templates.length === 0 && (
                <Card>
                  <CardBody>
                    <p style={{ fontSize: 'var(--text-md)', color: 'var(--fg-tertiary)', margin: 0 }}>No card types yet. Add one above.</p>
                  </CardBody>
                </Card>
              )}
            </>
          )}
        </div>
      </div>

      <Modal
        open={!!deleteTypeId}
        onClose={() => setDeleteTypeId(null)}
        size="sm"
        title="Delete Card Type"
        footer={
          <>
            <Button variant="secondary" size="sm" onClick={() => setDeleteTypeId(null)}>Cancel</Button>
            <Button variant="danger" size="sm" onClick={confirmDeleteType}>Delete</Button>
          </>
        }
      >
        <p style={{ fontSize: 'var(--text-md)', color: 'var(--fg-secondary)', margin: 0 }}>
          This deletes the card type and its fields. Countries already added keep working (they just unlink from this template). This cannot be undone.
        </p>
      </Modal>
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
    <div style={{ background: 'var(--bg-subtle)', borderRadius: 'var(--radius-lg)', padding: 12, margin: '8px 0', display: 'flex', flexDirection: 'column', gap: 10 }}>
      <Input placeholder="Field label" value={label} onChange={(e) => setLabel(e.target.value)} autoFocus />
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {INPUT_TYPE_OPTIONS.map((opt) => (
          <Button
            key={opt.value}
            variant={inputType === opt.value ? 'primary' : 'secondary'}
            size="sm"
            onClick={() => setInputType(opt.value)}
          >
            {opt.label}
          </Button>
        ))}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <span style={{ fontSize: 'var(--text-md)', color: 'var(--fg-secondary)', fontWeight: 600 }}>Required</span>
        <Toggle checked={required} onChange={setRequired} />
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        <Button variant="primary" size="sm" onClick={onSave} disabled={saving} loading={saving}>{saving ? 'Saving...' : 'Save'}</Button>
        <Button variant="secondary" size="sm" onClick={onCancel}>Cancel</Button>
      </div>
    </div>
  );
}
