'use client';

import { useEffect, useState } from 'react';

export function TermsOfUseManager({ onChange }: { onChange?: (terms: string[]) => void }) {
  const [open, setOpen] = useState(false);
  const [terms, setTerms] = useState<string[]>([]);
  const [newTerm, setNewTerm] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => { fetchTerms(); }, []);

  const fetchTerms = async () => {
    const res = await fetch('/api/app-config?keys=coupon_terms_of_use');
    const data = await res.json().catch(() => ({}));
    let parsed: string[] = [];
    try { parsed = JSON.parse(data?.config?.coupon_terms_of_use || '[]'); } catch {}
    setTerms(parsed);
    onChange?.(parsed);
  };

  const persist = async (next: string[]) => {
    setTerms(next);
    onChange?.(next);
    setSaving(true);
    await fetch('/api/app-config', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ changes: { coupon_terms_of_use: JSON.stringify(next) } }),
    });
    setSaving(false);
  };

  const add = () => {
    const v = newTerm.trim();
    if (!v || terms.includes(v)) return;
    persist([...terms, v]);
    setNewTerm('');
  };
  const remove = (t: string) => persist(terms.filter((x) => x !== t));

  return (
    <>
      <button style={s.openBtn} onClick={() => setOpen(true)} type="button">Manage Terms of Use</button>

      {open && (
        <div style={s.backdrop} onClick={() => setOpen(false)}>
          <div style={s.modal} onClick={(e) => e.stopPropagation()}>
            <div style={s.modalHead}>
              <p style={s.modalTitle}>Terms of Use</p>
              <button style={s.closeBtn} onClick={() => setOpen(false)} type="button">✕</button>
            </div>

            <p style={s.help}>Manage the master list. These appear as options when creating or editing a coupon.</p>

            <div style={s.addRow}>
              <input
                style={s.input}
                value={newTerm}
                onChange={(e) => setNewTerm(e.target.value)}
                placeholder="e.g. First-time users only"
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } }}
              />
              <button style={s.addBtn} onClick={add} type="button" disabled={saving}>Add</button>
            </div>

            <div style={s.list}>
              {terms.length === 0 ? (
                <p style={s.empty}>No terms yet — add one above.</p>
              ) : terms.map((t) => (
                <div key={t} style={s.row}>
                  <span style={s.rowText}>{t}</span>
                  <button onClick={() => remove(t)} style={s.removeBtn} type="button">Remove</button>
                </div>
              ))}
            </div>

            <div style={s.modalFoot}>
              <button style={s.doneBtn} onClick={() => setOpen(false)} type="button">Done</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

const s: Record<string, React.CSSProperties> = {
  openBtn: { backgroundColor: '#FFFFFF', color: '#111111', border: '1.5px solid #E8E8E8', borderRadius: 100, padding: '8px 16px', fontSize: 12, fontWeight: 700, cursor: 'pointer' },
  backdrop: { position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100, padding: 20 },
  modal: { backgroundColor: '#FFFFFF', borderRadius: 14, padding: 20, width: '100%', maxWidth: 480, maxHeight: '85vh', display: 'flex', flexDirection: 'column' },
  modalHead: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 },
  modalTitle: { fontSize: 15, fontWeight: 700, color: '#111111', margin: 0 },
  closeBtn: { background: 'transparent', border: 'none', fontSize: 18, color: '#888', cursor: 'pointer', padding: 4, lineHeight: 1 },
  help: { fontSize: 12, color: '#888888', margin: '0 0 14px' },
  addRow: { display: 'flex', gap: 8, marginBottom: 14 },
  input: { flex: 1, border: '1.5px solid #E8E8E8', borderRadius: 8, padding: '10px 14px', fontSize: 13, outline: 'none', boxSizing: 'border-box', backgroundColor: '#FFFFFF' },
  addBtn: { backgroundColor: '#111111', color: '#FFFFFF', border: 'none', borderRadius: 100, padding: '8px 18px', fontSize: 12, fontWeight: 700, cursor: 'pointer' },
  list: { flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 6 },
  empty: { fontSize: 12, color: '#AAA', textAlign: 'center', padding: 16, margin: 0 },
  row: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', backgroundColor: '#F7F7F7', borderRadius: 8, padding: '10px 12px' },
  rowText: { fontSize: 13, color: '#111', fontWeight: 500 },
  removeBtn: { backgroundColor: 'transparent', color: '#C62828', border: 'none', fontSize: 12, fontWeight: 700, cursor: 'pointer' },
  modalFoot: { display: 'flex', justifyContent: 'flex-end', marginTop: 14 },
  doneBtn: { backgroundColor: '#111111', color: '#FFFFFF', border: 'none', borderRadius: 100, padding: '8px 22px', fontSize: 12, fontWeight: 700, cursor: 'pointer' },
};
