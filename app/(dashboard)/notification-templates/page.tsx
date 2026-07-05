'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  PageHeader, Card, CardBody,
  Table, THead, TBody, Tr, Th, Td, TableEmpty,
  Button, Input, Textarea, FieldShell, Toggle, SidePanel,
} from '../../_ui';
import { useIsMobile } from '../../lib/useIsMobile';
import { StatusDot } from '../_shared/statusUi';

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
  const isMobile = useIsMobile();
  const [templates, setTemplates] = useState<Template[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [draftTitle, setDraftTitle] = useState('');
  const [draftBody, setDraftBody] = useState('');
  const [draftActive, setDraftActive] = useState(true);
  const [toast, setToast] = useState('');

  useEffect(() => { fetchTemplates(); }, []);

  const fetchTemplates = async (silent = false) => {
    if (!silent) setLoading(true);
    const res = await fetch('/api/notification-templates');
    const data = await res.json().catch(() => ({}));
    setTemplates(data.templates || []);
    if (!silent) setLoading(false);
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
    await fetchTemplates(true);
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

  const truncate = (b: string) => (b.length > 80 ? b.slice(0, 80) + '…' : b);

  return (
    <div>
      <PageHeader
        title="Notification Templates"
        subtitle="Messages sent to users when key actions occur. Edits apply immediately in production."
      />

      {loading ? (
        <Card>
          <CardBody>
            <p style={{ fontSize: 'var(--text-xs)', color: 'var(--fg-tertiary)', margin: 0 }}>Loading…</p>
          </CardBody>
        </Card>
      ) : isMobile ? (
        templates.length === 0 ? (
          <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-default)', borderRadius: 'var(--radius-xl)', padding: '48px 20px', textAlign: 'center', color: 'var(--fg-tertiary)', fontSize: 'var(--text-md)' }}>
            No templates
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {templates.map((t) => (
              <div key={t.key} onClick={() => openEditor(t)} style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-default)', borderRadius: 'var(--radius-xl)', padding: 14, cursor: 'pointer' }}>
                <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10 }}>
                  <div style={{ fontSize: 'var(--text-md)', fontWeight: 700, color: 'var(--fg-primary)', minWidth: 0 }}>{t.title}</div>
                  <StatusDot status={t.is_active ? 'ON' : 'OFF'} tone={t.is_active ? 'success' : 'danger'} />
                </div>
                <div style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)', color: 'var(--fg-tertiary)', marginTop: 4 }}>{t.key}</div>
                <div style={{ fontSize: 'var(--text-sm)', color: 'var(--fg-secondary)', marginTop: 8, lineHeight: 1.5 }}>{truncate(t.body)}</div>
              </div>
            ))}
          </div>
        )
      ) : (
        <Card>
          <CardBody flush>
            <Table flush>
              <THead>
                <Tr>
                  <Th>Key</Th>
                  <Th>Title</Th>
                  <Th>Body</Th>
                  <Th>Active</Th>
                  <Th align="right">Actions</Th>
                </Tr>
              </THead>
              <TBody>
                {templates.length === 0 ? (
                  <TableEmpty colSpan={5}>No templates</TableEmpty>
                ) : templates.map((t) => (
                  <Tr key={t.key}>
                    <Td mono emphasis="secondary">{t.key}</Td>
                    <Td emphasis="primary">{t.title}</Td>
                    <Td emphasis="secondary">
                      <span title={t.body} style={{ display: 'inline-block', maxWidth: 420, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', verticalAlign: 'bottom' }}>{truncate(t.body)}</span>
                    </Td>
                    <Td><StatusDot status={t.is_active ? 'ON' : 'OFF'} tone={t.is_active ? 'success' : 'danger'} /></Td>
                    <Td align="right">
                      <Button variant="ghost" size="sm" onClick={() => openEditor(t)}>Edit</Button>
                    </Td>
                  </Tr>
                ))}
              </TBody>
            </Table>
          </CardBody>
        </Card>
      )}

      <SidePanel
        open={!!selected}
        onClose={closeEditor}
        wide
        title="Edit template"
        subtitle={selected ? selected.key : undefined}
        footer={
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
            <Button variant="secondary" size="sm" onClick={closeEditor}>Cancel</Button>
            <Button variant="primary" size="sm" onClick={save} disabled={!dirty || saving} loading={saving}>
              {saving ? 'Saving…' : 'Save Changes'}
            </Button>
          </div>
        }
      >
        {selected && (
          <div style={{ display: 'grid', gap: 'var(--space-4)' }}>
            {selected.description && (
              <p style={{ fontSize: 'var(--text-sm)', color: 'var(--fg-secondary)', lineHeight: 1.5, margin: 0, padding: '10px 12px', background: 'var(--bg-subtle)', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-default)' }}>
                {selected.description}
              </p>
            )}

            <FieldShell label="Title">
              <Input value={draftTitle} onChange={(e) => setDraftTitle(e.target.value)} />
            </FieldShell>

            <FieldShell label="Body">
              <Textarea style={{ minHeight: 100 }} value={draftBody} onChange={(e) => setDraftBody(e.target.value)} />
            </FieldShell>

            {selected.variables.length > 0 && (
              <FieldShell label="Available variables (click to insert)">
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {selected.variables.map((v) => (
                    <button
                      key={v}
                      onClick={() => insertVar(v)}
                      style={{ fontSize: 11, fontFamily: 'var(--font-mono)', padding: '5px 10px', background: 'var(--bg-subtle)', color: 'var(--fg-secondary)', border: '1px solid var(--border-default)', borderRadius: 100, cursor: 'pointer' }}
                    >
                      {`{${v}}`}
                    </button>
                  ))}
                </div>
              </FieldShell>
            )}

            <FieldShell label="Preview (with sample data)">
              <div style={{ padding: 14, background: 'var(--bg-subtle)', borderRadius: 'var(--radius-lg)', border: '1px solid var(--border-default)' }}>
                <p style={{ fontSize: 'var(--text-sm)', fontWeight: 700, color: 'var(--fg-primary)', margin: '0 0 6px' }}>{renderPreview(draftTitle, selected.variables)}</p>
                <p style={{ fontSize: 'var(--text-sm)', color: 'var(--fg-secondary)', margin: 0, lineHeight: 1.5 }}>{renderPreview(draftBody, selected.variables)}</p>
              </div>
            </FieldShell>

            <FieldShell label="Active" help="Disable to stop sending this notification entirely.">
              <Toggle checked={draftActive} onChange={(next) => setDraftActive(next)} />
            </FieldShell>
          </div>
        )}
      </SidePanel>

      {toast && (
        <div style={{
          position: 'fixed', bottom: 20, right: 20, background: 'var(--bg-surface)',
          border: '1px solid var(--border-default)', color: 'var(--fg-primary)',
          padding: '10px 16px', borderRadius: 'var(--radius-lg)', fontSize: 'var(--text-xs)',
          fontWeight: 600, boxShadow: 'var(--shadow-md)', zIndex: 100,
        }}>
          {toast}
        </div>
      )}
    </div>
  );
}
