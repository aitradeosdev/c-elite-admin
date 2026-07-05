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
  const isMobile = useIsMobile();
  const [templates, setTemplates] = useState<Template[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [draftSubject, setDraftSubject] = useState('');
  const [draftHtml, setDraftHtml] = useState('');
  const [draftActive, setDraftActive] = useState(true);
  const [toast, setToast] = useState('');

  useEffect(() => { fetchTemplates(); }, []);

  const fetchTemplates = async (silent = false) => {
    if (!silent) setLoading(true);
    const res = await fetch('/api/email-templates');
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
    await fetchTemplates(true);
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

  const templateStatus = (active: boolean) => (
    <StatusDot status={active ? 'On' : 'Off'} tone={active ? 'success' : 'danger'} />
  );

  const mono: React.CSSProperties = {
    fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)',
    background: 'var(--bg-subtle)', padding: '2px 6px', borderRadius: 4,
    color: 'var(--fg-secondary)',
  };

  return (
    <div>
      <PageHeader
        title="Email Templates"
        subtitle="Transactional emails sent via SMTP. Edits apply immediately in production."
      />

      {loading ? (
        <Card>
          <CardBody>
            <p style={{ fontSize: 'var(--text-xs)', color: 'var(--fg-tertiary)', margin: 0 }}>Loading…</p>
          </CardBody>
        </Card>
      ) : isMobile ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {templates.length === 0 ? (
            <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-default)', borderRadius: 'var(--radius-xl)', padding: '48px 20px', textAlign: 'center', color: 'var(--fg-tertiary)', fontSize: 'var(--text-md)' }}>
              No templates found
            </div>
          ) : templates.map((t) => (
            <div key={t.key} onClick={() => openEditor(t)} style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-default)', borderRadius: 'var(--radius-xl)', padding: 14, cursor: 'pointer' }}>
              <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10 }}>
                <span style={mono}>{t.key}</span>
                {templateStatus(t.is_active)}
              </div>
              <div style={{ fontSize: 'var(--text-md)', color: 'var(--fg-secondary)', marginTop: 8 }} title={t.subject}>
                {t.subject.length > 80 ? t.subject.slice(0, 80) + '…' : t.subject}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <Card>
          <CardBody flush>
            <Table flush>
              <THead>
                <Tr>
                  <Th>Key</Th>
                  <Th>Subject</Th>
                  <Th>Active</Th>
                  <Th align="right">Actions</Th>
                </Tr>
              </THead>
              <TBody>
                {templates.length === 0 ? (
                  <TableEmpty colSpan={4}>No templates found</TableEmpty>
                ) : templates.map((t) => (
                  <Tr key={t.key}>
                    <Td><span style={mono}>{t.key}</span></Td>
                    <Td emphasis="secondary" style={{ maxWidth: 420 }}>
                      <span title={t.subject}>{t.subject.length > 80 ? t.subject.slice(0, 80) + '…' : t.subject}</span>
                    </Td>
                    <Td>{templateStatus(t.is_active)}</Td>
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
        title="Edit email template"
        subtitle={selected ? selected.key : undefined}
        footer={selected ? (
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, width: '100%' }}>
            <Button variant="secondary" size="sm" onClick={closeEditor}>Cancel</Button>
            <Button variant="primary" size="sm" onClick={save} disabled={!dirty || saving} loading={saving}>
              {saving ? 'Saving…' : 'Save Changes'}
            </Button>
          </div>
        ) : undefined}
      >
        {selected && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
            {selected.description && (
              <p style={{ fontSize: 'var(--text-xs)', color: 'var(--fg-secondary)', lineHeight: 1.5, margin: 0, padding: '10px 12px', background: 'var(--bg-subtle)', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-default)' }}>
                {selected.description}
              </p>
            )}

            <FieldShell label="Subject">
              <Input value={draftSubject} onChange={(e) => setDraftSubject(e.target.value)} />
            </FieldShell>

            {selected.variables.length > 0 && (
              <FieldShell label="Insert into subject">
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {selected.variables.map((v) => (
                    <Button key={v} variant="secondary" size="sm" onClick={() => insertVar('subject', v)}>
                      {`{${v}}`}
                    </Button>
                  ))}
                </div>
              </FieldShell>
            )}

            <FieldShell label="HTML">
              <Textarea
                style={{ height: 220, resize: 'vertical', fontFamily: 'var(--font-mono)', fontSize: 12 }}
                value={draftHtml}
                onChange={(e) => setDraftHtml(e.target.value)}
              />
            </FieldShell>

            {selected.variables.length > 0 && (
              <FieldShell label="Insert into HTML">
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {selected.variables.map((v) => (
                    <Button key={v} variant="secondary" size="sm" onClick={() => insertVar('html', v)}>
                      {`{${v}}`}
                    </Button>
                  ))}
                </div>
              </FieldShell>
            )}

            <FieldShell label="Preview (with sample data)">
              <div style={{ display: 'flex', gap: 8, padding: '10px 14px', background: 'var(--bg-subtle)', border: '1px solid var(--border-default)', borderBottom: 'none', borderRadius: '8px 8px 0 0' }}>
                <span style={{ fontSize: 'var(--text-xs)', fontWeight: 700, color: 'var(--fg-secondary)' }}>Subject:</span>
                <span style={{ fontSize: 'var(--text-sm)', fontWeight: 700, color: 'var(--fg-primary)' }}>{renderPreview(draftSubject, selected.variables)}</span>
              </div>
              <iframe
                title="Email preview"
                style={{ width: '100%', height: 420, background: 'var(--bg-surface)', border: '1px solid var(--border-default)', borderRadius: '0 0 8px 8px' }}
                sandbox=""
                srcDoc={renderPreview(draftHtml, selected.variables)}
              />
            </FieldShell>

            <Toggle
              checked={draftActive}
              onChange={(v) => setDraftActive(v)}
              label="Active — disable to stop sending this email entirely."
            />
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
