'use client';

import { useEffect, useMemo, useState } from 'react';

interface Template {
  key: string;
  title: string;
  body: string;
  description: string | null;
  variables: string[];
  is_active: boolean;
  updated_at: string;
}

export default function NotificationTemplatesPage() {
  const [templates, setTemplates] = useState<Template[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [draftTitle, setDraftTitle] = useState('');
  const [draftBody, setDraftBody] = useState('');
  const [draftActive, setDraftActive] = useState(true);
  const [toast, setToast] = useState('');

  useEffect(() => { fetchTemplates(); }, []);

  const fetchTemplates = async () => {
    setLoading(true);
    const res = await fetch('/api/notification-templates');
    const data = await res.json().catch(() => ({}));
    setTemplates(data.templates || []);
    setLoading(false);
  };

  const showToast = (msg: string) => { setToast(msg); setTimeout(() => setToast(''), 3000); };

  const selected = useMemo(
    () => templates.find((t) => t.key === selectedKey) || null,
    [templates, selectedKey],
  );

  const openEditor = (t: Template) => {
    setSelectedKey(t.key);
    setDraftTitle(t.title);
    setDraftBody(t.body);
    setDraftActive(t.is_active);
  };

  const closeEditor = () => {
    setSelectedKey(null);
    setDraftTitle('');
    setDraftBody('');
    setDraftActive(true);
  };

  const dirty =
    !!selected &&
    (draftTitle !== selected.title ||
      draftBody !== selected.body ||
      draftActive !== selected.is_active);

  const save = async () => {
    if (!selected || !dirty) return;
    setSaving(true);
    const res = await fetch('/api/notification-templates', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        key: selected.key,
        title: draftTitle,
        body: draftBody,
        is_active: draftActive,
      }),
    });
    const data = await res.json().catch(() => ({}));
    setSaving(false);
    if (!res.ok) { showToast(data.error || 'Save failed'); return; }
    showToast('Saved');
    closeEditor();
    await fetchTemplates();
  };

  const insertVar = (v: string) => {
    setDraftBody((b) => b + `{${v}}`);
  };

  const renderPreview = (body: string, vars: string[]) => {
    let out = body;
    vars.forEach((v) => {
      const sample =
        v === 'symbol' ? '$' :
        v === 'amount_foreign' ? '50' :
        v === 'card_name' ? 'Amazon' :
        v === 'type_parens' ? ' (USA)' :
        v === 'credit' ? '72,500' :
        v === 'card_label' ? '$50 Amazon (USA)' :
        v === 'reason' ? 'Card already redeemed' :
        v === 'amount' ? '10,000' :
        v === 'total' ? '10,500' :
        v === 'sender_username' ? 'john' :
        v === 'provider' ? 'MTN' :
        v === 'type' ? 'airtime' :
        `{${v}}`;
      out = out.split(`{${v}}`).join(sample);
    });
    return out;
  };

  if (loading) return <div><h1 style={styles.h1}>Notification Templates</h1><p style={styles.empty}>Loading…</p></div>;

  return (
    <div>
      <h1 style={styles.h1}>Notification Templates</h1>
      <p style={styles.sub}>Messages sent to users when key actions occur. Edits apply immediately in production.</p>

      <div style={styles.tableWrap}>
        <table style={styles.table}>
          <thead>
            <tr>
              <th style={styles.th}>Key</th>
              <th style={styles.th}>Title</th>
              <th style={styles.th}>Body</th>
              <th style={styles.th}>Active</th>
              <th style={styles.th}></th>
            </tr>
          </thead>
          <tbody>
            {templates.map((t) => (
              <tr key={t.key} style={styles.tr}>
                <td style={styles.td}><code style={styles.code}>{t.key}</code></td>
                <td style={styles.td}>{t.title}</td>
                <td style={{ ...styles.td, color: '#555', maxWidth: 420 }}>
                  <span title={t.body}>{t.body.length > 80 ? t.body.slice(0, 80) + '…' : t.body}</span>
                </td>
                <td style={styles.td}>
                  <span style={{ ...styles.pill, backgroundColor: t.is_active ? '#E8F5E9' : '#FFEBEE', color: t.is_active ? '#1B5E20' : '#C62828' }}>
                    {t.is_active ? 'ON' : 'OFF'}
                  </span>
                </td>
                <td style={styles.td}>
                  <button style={styles.editBtn} onClick={() => openEditor(t)}>Edit</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {selected && (
        <>
          <div style={styles.dim} onClick={closeEditor} />
          <div style={styles.drawer}>
            <div style={styles.drawerHeader}>
              <div>
                <p style={styles.drawerTitle}>Edit template</p>
                <code style={styles.code}>{selected.key}</code>
              </div>
              <button style={styles.closeBtn} onClick={closeEditor}>×</button>
            </div>

            {selected.description && (
              <p style={styles.desc}>{selected.description}</p>
            )}

            <label style={styles.label}>Title</label>
            <input
              style={styles.input}
              value={draftTitle}
              onChange={(e) => setDraftTitle(e.target.value)}
            />

            <label style={styles.label}>Body</label>
            <textarea
              style={{ ...styles.input, height: 100, resize: 'vertical', fontFamily: 'inherit' } as any}
              value={draftBody}
              onChange={(e) => setDraftBody(e.target.value)}
            />

            {selected.variables.length > 0 && (
              <>
                <label style={styles.label}>Available variables (click to insert)</label>
                <div style={styles.chipRow}>
                  {selected.variables.map((v) => (
                    <button key={v} style={styles.chip} onClick={() => insertVar(v)}>
                      {`{${v}}`}
                    </button>
                  ))}
                </div>
              </>
            )}

            <label style={styles.label}>Preview (with sample data)</label>
            <div style={styles.preview}>
              <p style={styles.previewTitle}>{renderPreview(draftTitle, selected.variables)}</p>
              <p style={styles.previewBody}>{renderPreview(draftBody, selected.variables)}</p>
            </div>

            <label style={styles.checkboxRow}>
              <input
                type="checkbox"
                checked={draftActive}
                onChange={(e) => setDraftActive(e.target.checked)}
              />
              <span style={{ marginLeft: 8 }}>Active — disable to stop sending this notification entirely.</span>
            </label>

            <div style={styles.footer}>
              <button style={styles.cancelBtn} onClick={closeEditor}>Cancel</button>
              <button
                style={{ ...styles.saveBtn, opacity: dirty && !saving ? 1 : 0.4 }}
                onClick={save}
                disabled={!dirty || saving}
              >
                {saving ? 'Saving…' : 'Save Changes'}
              </button>
            </div>
          </div>
        </>
      )}

      {toast && <div style={styles.toast}>{toast}</div>}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  h1: { fontSize: 20, fontWeight: 800, color: '#111', margin: '0 0 6px' },
  sub: { fontSize: 12, color: '#666', margin: '0 0 16px' },
  tableWrap: { backgroundColor: '#FFF', border: '1px solid #EEE', borderRadius: 10, overflow: 'hidden' },
  table: { width: '100%', borderCollapse: 'collapse' as any, fontSize: 13 },
  th: { textAlign: 'left', padding: '10px 12px', backgroundColor: '#FAFAFA', color: '#555', fontWeight: 600, borderBottom: '1px solid #EEE', fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.3 },
  tr: { borderBottom: '1px solid #F3F3F3' },
  td: { padding: '12px', color: '#111', verticalAlign: 'middle' },
  code: { fontFamily: 'monospace', fontSize: 11, backgroundColor: '#F5F5F5', padding: '2px 6px', borderRadius: 4, color: '#333' },
  pill: { fontSize: 10, fontWeight: 700, padding: '3px 8px', borderRadius: 100 },
  editBtn: { padding: '6px 12px', fontSize: 12, fontWeight: 600, backgroundColor: '#111', color: '#FFF', border: 'none', borderRadius: 6, cursor: 'pointer' },
  dim: { position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.3)', zIndex: 50 },
  drawer: { position: 'fixed', top: 0, right: 0, width: 520, height: '100%', backgroundColor: '#FFF', padding: 24, boxSizing: 'border-box', overflowY: 'auto', zIndex: 51, boxShadow: '-4px 0 12px rgba(0,0,0,0.08)' },
  drawerHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 },
  drawerTitle: { fontSize: 16, fontWeight: 800, color: '#111', margin: '0 0 4px' },
  closeBtn: { background: 'none', border: 'none', fontSize: 28, lineHeight: 1, color: '#999', cursor: 'pointer' },
  desc: { fontSize: 12, color: '#666', lineHeight: 1.5, margin: '8px 0 16px', padding: '10px 12px', backgroundColor: '#FAFAFA', borderRadius: 6, border: '1px solid #EEE' },
  label: { display: 'block', fontSize: 11, fontWeight: 600, color: '#555', marginTop: 14, marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.3 },
  input: { width: '100%', padding: '10px 12px', fontSize: 14, border: '1px solid #DDD', borderRadius: 6, boxSizing: 'border-box' },
  chipRow: { display: 'flex', flexWrap: 'wrap', gap: 6 },
  chip: { fontSize: 11, fontFamily: 'monospace', padding: '5px 10px', backgroundColor: '#F0F0F0', color: '#111', border: '1px solid #DDD', borderRadius: 100, cursor: 'pointer' },
  preview: { padding: 14, backgroundColor: '#F7F9FC', borderRadius: 8, border: '1px solid #E4E8EF' },
  previewTitle: { fontSize: 13, fontWeight: 800, color: '#111', margin: '0 0 6px' },
  previewBody: { fontSize: 13, color: '#333', margin: 0, lineHeight: 1.5 },
  checkboxRow: { display: 'flex', alignItems: 'center', marginTop: 20, fontSize: 12, color: '#555' },
  footer: { display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 24 },
  cancelBtn: { padding: '10px 18px', fontSize: 13, fontWeight: 600, backgroundColor: '#FFF', color: '#111', border: '1px solid #DDD', borderRadius: 6, cursor: 'pointer' },
  saveBtn: { padding: '10px 20px', fontSize: 13, fontWeight: 700, backgroundColor: '#111', color: '#FFF', border: 'none', borderRadius: 6, cursor: 'pointer' },
  empty: { fontSize: 12, color: '#888' },
  toast: { position: 'fixed', bottom: 20, right: 20, backgroundColor: '#111', color: '#FFF', padding: '10px 16px', borderRadius: 6, fontSize: 12, fontWeight: 600, zIndex: 100 },
};
