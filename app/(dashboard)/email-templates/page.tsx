'use client';

import { useEffect, useMemo, useState } from 'react';

interface Template {
  key: string;
  subject: string;
  html: string;
  description: string | null;
  variables: string[];
  is_active: boolean;
  updated_at: string;
}

const SAMPLES: Record<string, string> = {
  first_name: 'John',
  device_model: 'iPhone 14',
  os_version: 'iOS 17.1',
  app_version: '1.2.0',
  ip: '102.89.34.12',
  when: '4/17/2026, 10:42:15 AM',
  severity_upper: 'CRITICAL',
  severity_color: '#C62828',
  alert_type: 'failed_login_burst',
  alert_subject: 'Repeated failed admin logins from 102.89.34.12',
  detail_json: '{\n  "ip": "102.89.34.12",\n  "count": 12\n}',
  fired_at: '2026-04-17T10:42:15.000Z',
};

export default function EmailTemplatesPage() {
  const [templates, setTemplates] = useState<Template[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [draftSubject, setDraftSubject] = useState('');
  const [draftHtml, setDraftHtml] = useState('');
  const [draftActive, setDraftActive] = useState(true);
  const [toast, setToast] = useState('');

  useEffect(() => { fetchTemplates(); }, []);

  const fetchTemplates = async () => {
    setLoading(true);
    const res = await fetch('/api/email-templates');
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
    setDraftSubject(t.subject);
    setDraftHtml(t.html);
    setDraftActive(t.is_active);
  };

  const closeEditor = () => {
    setSelectedKey(null);
    setDraftSubject('');
    setDraftHtml('');
    setDraftActive(true);
  };

  const dirty =
    !!selected &&
    (draftSubject !== selected.subject ||
      draftHtml !== selected.html ||
      draftActive !== selected.is_active);

  const save = async () => {
    if (!selected || !dirty) return;
    setSaving(true);
    const res = await fetch('/api/email-templates', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        key: selected.key,
        subject: draftSubject,
        html: draftHtml,
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

  const insertVar = (target: 'subject' | 'html', v: string) => {
    if (target === 'subject') setDraftSubject((s) => s + `{${v}}`);
    else setDraftHtml((h) => h + `{${v}}`);
  };

  const renderPreview = (source: string, vars: string[]) => {
    let out = source;
    vars.forEach((v) => {
      const sample = SAMPLES[v] ?? `{${v}}`;
      out = out.split(`{${v}}`).join(sample);
    });
    return out;
  };

  if (loading) return <div><h1 style={styles.h1}>Email Templates</h1><p style={styles.empty}>Loading…</p></div>;

  return (
    <div>
      <h1 style={styles.h1}>Email Templates</h1>
      <p style={styles.sub}>Transactional emails sent via SMTP. Edits apply immediately in production.</p>

      <div style={styles.tableWrap}>
        <table style={styles.table}>
          <thead>
            <tr>
              <th style={styles.th}>Key</th>
              <th style={styles.th}>Subject</th>
              <th style={styles.th}>Active</th>
              <th style={styles.th}></th>
            </tr>
          </thead>
          <tbody>
            {templates.map((t) => (
              <tr key={t.key} style={styles.tr}>
                <td style={styles.td}><code style={styles.code}>{t.key}</code></td>
                <td style={{ ...styles.td, color: '#555', maxWidth: 420 }}>
                  <span title={t.subject}>{t.subject.length > 80 ? t.subject.slice(0, 80) + '…' : t.subject}</span>
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
                <p style={styles.drawerTitle}>Edit email template</p>
                <code style={styles.code}>{selected.key}</code>
              </div>
              <button style={styles.closeBtn} onClick={closeEditor}>×</button>
            </div>

            {selected.description && (
              <p style={styles.desc}>{selected.description}</p>
            )}

            <label style={styles.label}>Subject</label>
            <input
              style={styles.input}
              value={draftSubject}
              onChange={(e) => setDraftSubject(e.target.value)}
            />

            {selected.variables.length > 0 && (
              <>
                <label style={styles.label}>Insert into subject</label>
                <div style={styles.chipRow}>
                  {selected.variables.map((v) => (
                    <button key={v} style={styles.chip} onClick={() => insertVar('subject', v)}>
                      {`{${v}}`}
                    </button>
                  ))}
                </div>
              </>
            )}

            <label style={styles.label}>HTML</label>
            <textarea
              style={{ ...styles.input, height: 220, resize: 'vertical', fontFamily: 'monospace', fontSize: 12 } as React.CSSProperties}
              value={draftHtml}
              onChange={(e) => setDraftHtml(e.target.value)}
            />

            {selected.variables.length > 0 && (
              <>
                <label style={styles.label}>Insert into HTML</label>
                <div style={styles.chipRow}>
                  {selected.variables.map((v) => (
                    <button key={v} style={styles.chip} onClick={() => insertVar('html', v)}>
                      {`{${v}}`}
                    </button>
                  ))}
                </div>
              </>
            )}

            <label style={styles.label}>Preview (with sample data)</label>
            <div style={styles.previewSubjectRow}>
              <span style={styles.previewLabel}>Subject:</span>
              <span style={styles.previewSubject}>{renderPreview(draftSubject, selected.variables)}</span>
            </div>
            <div
              style={styles.previewFrame}
              dangerouslySetInnerHTML={{ __html: renderPreview(draftHtml, selected.variables) }}
            />

            <label style={styles.checkboxRow}>
              <input
                type="checkbox"
                checked={draftActive}
                onChange={(e) => setDraftActive(e.target.checked)}
              />
              <span style={{ marginLeft: 8 }}>Active — disable to stop sending this email entirely.</span>
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
  table: { width: '100%', borderCollapse: 'collapse', fontSize: 13 },
  th: { textAlign: 'left', padding: '10px 12px', backgroundColor: '#FAFAFA', color: '#555', fontWeight: 600, borderBottom: '1px solid #EEE', fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.3 },
  tr: { borderBottom: '1px solid #F3F3F3' },
  td: { padding: '12px', color: '#111', verticalAlign: 'middle' },
  code: { fontFamily: 'monospace', fontSize: 11, backgroundColor: '#F5F5F5', padding: '2px 6px', borderRadius: 4, color: '#333' },
  pill: { fontSize: 10, fontWeight: 700, padding: '3px 8px', borderRadius: 100 },
  editBtn: { padding: '6px 12px', fontSize: 12, fontWeight: 600, backgroundColor: '#111', color: '#FFF', border: 'none', borderRadius: 6, cursor: 'pointer' },
  dim: { position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.3)', zIndex: 50 },
  drawer: { position: 'fixed', top: 0, right: 0, width: 640, height: '100%', backgroundColor: '#FFF', padding: 24, boxSizing: 'border-box', overflowY: 'auto', zIndex: 51, boxShadow: '-4px 0 12px rgba(0,0,0,0.08)' },
  drawerHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 },
  drawerTitle: { fontSize: 16, fontWeight: 800, color: '#111', margin: '0 0 4px' },
  closeBtn: { background: 'none', border: 'none', fontSize: 28, lineHeight: 1, color: '#999', cursor: 'pointer' },
  desc: { fontSize: 12, color: '#666', lineHeight: 1.5, margin: '8px 0 16px', padding: '10px 12px', backgroundColor: '#FAFAFA', borderRadius: 6, border: '1px solid #EEE' },
  label: { display: 'block', fontSize: 11, fontWeight: 600, color: '#555', marginTop: 14, marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.3 },
  input: { width: '100%', padding: '10px 12px', fontSize: 14, border: '1px solid #DDD', borderRadius: 6, boxSizing: 'border-box' },
  chipRow: { display: 'flex', flexWrap: 'wrap', gap: 6 },
  chip: { fontSize: 11, fontFamily: 'monospace', padding: '5px 10px', backgroundColor: '#F0F0F0', color: '#111', border: '1px solid #DDD', borderRadius: 100, cursor: 'pointer' },
  previewSubjectRow: { display: 'flex', gap: 8, padding: '10px 14px', backgroundColor: '#F7F9FC', border: '1px solid #E4E8EF', borderBottom: 'none', borderRadius: '8px 8px 0 0' },
  previewLabel: { fontSize: 11, fontWeight: 700, color: '#666' },
  previewSubject: { fontSize: 13, fontWeight: 700, color: '#111' },
  previewFrame: { padding: 14, backgroundColor: '#FFFFFF', border: '1px solid #E4E8EF', borderRadius: '0 0 8px 8px', maxHeight: 420, overflowY: 'auto' },
  checkboxRow: { display: 'flex', alignItems: 'center', marginTop: 20, fontSize: 12, color: '#555' },
  footer: { display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 24 },
  cancelBtn: { padding: '10px 18px', fontSize: 13, fontWeight: 600, backgroundColor: '#FFF', color: '#111', border: '1px solid #DDD', borderRadius: 6, cursor: 'pointer' },
  saveBtn: { padding: '10px 20px', fontSize: 13, fontWeight: 700, backgroundColor: '#111', color: '#FFF', border: 'none', borderRadius: 6, cursor: 'pointer' },
  empty: { fontSize: 12, color: '#888' },
  toast: { position: 'fixed', bottom: 20, right: 20, backgroundColor: '#111', color: '#FFF', padding: '10px 16px', borderRadius: 6, fontSize: 12, fontWeight: 600, zIndex: 100 },
};
