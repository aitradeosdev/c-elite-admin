'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  PageHeader, Card, CardBody, Table, THead, TBody, Tr, Th, Td, TableEmpty,
  Button, Input, FieldShell, SidePanel, Modal,
} from '../../_ui';
import { useIsMobile } from '../../lib/useIsMobile';
import { StatusDot, StatStrip } from '../_shared/statusUi';

const ASSIGNABLE_PAGES = [
  { key: 'dashboard', label: 'Dashboard' },
  { key: 'card_queue', label: 'Card Queue' },
  { key: 'card_management', label: 'Card & Country Management' },
  { key: 'card_type_builder', label: 'Card Type & Field Builder' },
  { key: 'rates_management', label: 'Rates Management' },
  { key: 'withdrawals', label: 'Withdrawals' },
  { key: 'transfers', label: 'Transfers' },
  { key: 'users', label: 'Users' },
  { key: 'transactions_overview', label: 'Transactions Overview' },
  { key: 'bonuses_rewards', label: 'Bonuses & Rewards' },
  { key: 'referral_management', label: 'Referral Management' },
  { key: 'coupons', label: 'Coupons' },
  { key: 'notifications_broadcast', label: 'Notifications Broadcast' },
  { key: 'notification_templates', label: 'Notification Templates' },
  { key: 'email_templates', label: 'Email Templates' },
  { key: 'platform_balance', label: 'Platform Balance' },
  { key: 'activity', label: 'Activity (Audit Log)' },
  { key: 'limits_fees', label: 'Limits & Fees' },
  { key: 'admin_settings', label: 'Settings' },
  { key: 'bill_settings', label: 'Bill Settings' },
  { key: 'anomaly_alerts', label: 'Anomaly & Alerts' },
  { key: 'security_limits', label: 'Rate Limits & Webhook IPs' },
  { key: 'user_activity_monitor', label: 'User Activity Monitor' },
];

interface AdminUser {
  id: string;
  username: string;
  email: string | null;
  role_title: string;
  page_permissions: string[];
  last_login_at: string | null;
  is_active: boolean;
  is_super_admin: boolean;
  deleted_at: string | null;
}

type PanelMode = 'create' | 'edit' | null;

function formatPages(pages: string[]) {
  if (!pages || pages.length === 0) return '-';
  const labels = pages.map((p) => ASSIGNABLE_PAGES.find((a) => a.key === p)?.label || p);
  if (labels.length <= 3) return labels.join(', ');
  return labels.slice(0, 3).join(', ') + '...';
}

function AdminActions({
  admin, onEdit, onToggle, onDelete,
}: {
  admin: AdminUser;
  onEdit: (a: AdminUser) => void;
  onToggle: (a: AdminUser) => void;
  onDelete: (a: AdminUser) => void;
}) {
  if (admin.is_super_admin || admin.deleted_at) return <span style={{ color: 'var(--fg-tertiary)' }}>—</span>;
  return (
    <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
      <Button variant="ghost" size="sm" onClick={() => onEdit(admin)}>Edit</Button>
      <Button variant="secondary" size="sm" onClick={() => onToggle(admin)}>
        {admin.is_active ? 'Deactivate' : 'Reactivate'}
      </Button>
      {!admin.is_active && (
        <Button variant="dangerSubtle" size="sm" onClick={() => onDelete(admin)}>Delete</Button>
      )}
    </div>
  );
}

function AdminAccountsMobile({
  admins, loading, onEdit, onToggle, onDelete,
}: {
  admins: AdminUser[];
  loading: boolean;
  onEdit: (a: AdminUser) => void;
  onToggle: (a: AdminUser) => void;
  onDelete: (a: AdminUser) => void;
}) {
  if (loading && admins.length === 0) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {[0, 1, 2, 3].map((k) => (
          <div key={k} style={{ height: 96, background: 'var(--bg-surface)', border: '1px solid var(--border-default)', borderRadius: 'var(--radius-xl)', opacity: 0.5 }} />
        ))}
      </div>
    );
  }
  if (admins.length === 0) {
    return (
      <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-default)', borderRadius: 'var(--radius-xl)', padding: '48px 20px', textAlign: 'center', color: 'var(--fg-tertiary)', fontSize: 'var(--text-md)' }}>
        No admin accounts yet
      </div>
    );
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {admins.map((admin) => (
        <div key={admin.id} style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-default)', borderRadius: 'var(--radius-xl)', padding: 14 }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10 }}>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 'var(--text-md)', fontWeight: 700, color: 'var(--fg-primary)' }}>
                {admin.username}
                {admin.deleted_at && <span style={{ color: 'var(--tone-danger-fg)', fontWeight: 500, fontSize: 'var(--text-xs)' }}> (deleted admin)</span>}
              </div>
              <div style={{ fontSize: 'var(--text-sm)', color: 'var(--fg-secondary)', marginTop: 2 }}>{admin.role_title}</div>
            </div>
            <StatusDot status={admin.is_active ? 'Active' : 'Inactive'} tone={admin.is_active ? 'success' : 'neutral'} />
          </div>
          <div style={{ marginTop: 8, fontSize: 'var(--text-sm)', color: admin.email ? 'var(--fg-secondary)' : 'var(--tone-danger-fg)' }}>
            {admin.email || '— (no alerts)'}
          </div>
          <div style={{ marginTop: 6, fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)', color: 'var(--fg-tertiary)' }}>
            {formatPages(admin.page_permissions)}
          </div>
          <div style={{ marginTop: 6, fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)', color: 'var(--fg-tertiary)' }}>
            last login {admin.last_login_at ? new Date(admin.last_login_at).toLocaleDateString() : 'never'}
          </div>
          {!admin.is_super_admin && !admin.deleted_at && (
            <div style={{ display: 'flex', gap: 6, marginTop: 12, flexWrap: 'wrap' }}>
              <Button variant="ghost" size="sm" onClick={() => onEdit(admin)}>Edit</Button>
              <Button variant="secondary" size="sm" onClick={() => onToggle(admin)}>
                {admin.is_active ? 'Deactivate' : 'Reactivate'}
              </Button>
              {!admin.is_active && (
                <Button variant="dangerSubtle" size="sm" onClick={() => onDelete(admin)}>Delete</Button>
              )}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

export default function AdminAccountsPage() {
  const router = useRouter();
  const isMobile = useIsMobile();
  const [admins, setAdmins] = useState<AdminUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [panelMode, setPanelMode] = useState<PanelMode>(null);
  const [editTarget, setEditTarget] = useState<AdminUser | null>(null);

  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [roleTitle, setRoleTitle] = useState('');
  const [selectedPages, setSelectedPages] = useState<string[]>([]);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [formError, setFormError] = useState('');
  const [saving, setSaving] = useState(false);

  const [deleteTarget, setDeleteTarget] = useState<AdminUser | null>(null);
  const [deleteInput, setDeleteInput] = useState('');
  const [deleteError, setDeleteError] = useState('');

  useEffect(() => {
    fetchAdmins();
  }, []);

  const fetchAdmins = async (silent = false) => {
    if (!silent) setLoading(true);
    const res = await fetch('/api/admin-accounts');
    if (res.status === 403) { if (!silent) setLoading(false); return; }
    const data = await res.json();
    setAdmins(data.admins || []);
    if (!silent) setLoading(false);
  };

  const openCreate = () => {
    setEditTarget(null);
    setUsername(''); setEmail(''); setPassword(''); setConfirmPassword('');
    setRoleTitle(''); setSelectedPages([]); setFormError('');
    setPanelMode('create');
  };

  const openEdit = (admin: AdminUser) => {
    setEditTarget(admin);
    setUsername(admin.username);
    setEmail(admin.email || '');
    setPassword(''); setConfirmPassword('');
    setRoleTitle(admin.role_title);
    setSelectedPages(admin.page_permissions || []);
    setFormError('');
    setPanelMode('edit');
  };

  const closePanel = () => { setPanelMode(null); setEditTarget(null); };

  const togglePage = (key: string) => {
    setSelectedPages((prev) =>
      prev.includes(key) ? prev.filter((p) => p !== key) : [...prev, key]
    );
  };

  const handleSave = async () => {
    setFormError('');
    if (!username.trim() || !roleTitle.trim()) { setFormError('Username and role title are required.'); return; }
    if (panelMode === 'create' && !email.trim()) { setFormError('Email is required (used for security alerts).'); return; }
    if (email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) { setFormError('Enter a valid email.'); return; }
    if (panelMode === 'create' && !password) { setFormError('Password is required.'); return; }
    if (password && password !== confirmPassword) { setFormError('Passwords do not match.'); return; }
    if (selectedPages.length === 0) { setFormError('Assign at least one page.'); return; }

    setSaving(true);
    const res = await fetch('/api/admin-accounts', {
      method: panelMode === 'create' ? 'POST' : 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: editTarget?.id,
        username: username.trim(),
        email: email.trim(),
        password: password || undefined,
        role_title: roleTitle.trim(),
        page_permissions: selectedPages,
      }),
    });
    const data = await res.json();
    setSaving(false);
    if (!res.ok) { setFormError(data.error || 'Failed to save.'); return; }
    closePanel();
    fetchAdmins(true);
  };

  const handleToggleActive = async (admin: AdminUser) => {
    await fetch('/api/admin-accounts', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: admin.id, is_active: !admin.is_active }),
    });
    fetchAdmins(true);
  };

  const handleDelete = async () => {
    if (!deleteTarget || deleteInput !== 'DELETE') return;
    setDeleteError('');
    const res = await fetch('/api/admin-accounts', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: deleteTarget.id }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setDeleteError(data.error || 'Failed to delete.');
      return;
    }
    setDeleteTarget(null);
    setDeleteInput('');
    fetchAdmins(true);
  };

  const openDelete = (admin: AdminUser) => { setDeleteTarget(admin); setDeleteInput(''); setDeleteError(''); };

  const activeCount = admins.filter((a) => a.is_active && !a.deleted_at).length;

  return (
    <div>
      <PageHeader
        title="Admin Accounts"
        subtitle="Provision console operators, scope their page access, and revoke when needed."
        actions={
          <Button variant="primary" size="sm" onClick={openCreate}>+ Create Admin</Button>
        }
      />

      <StatStrip items={[
        { label: 'Total accounts', value: admins.length.toLocaleString() },
        { label: 'Active', value: activeCount.toLocaleString() },
      ]} />

      {isMobile ? (
        <AdminAccountsMobile
          admins={admins}
          loading={loading}
          onEdit={openEdit}
          onToggle={handleToggleActive}
          onDelete={openDelete}
        />
      ) : (
        <Card>
          <CardBody flush>
            <Table flush>
              <THead>
                <Tr>
                  <Th>Username</Th>
                  <Th>Email</Th>
                  <Th>Role Title</Th>
                  <Th>Assigned Pages</Th>
                  <Th>Last Login</Th>
                  <Th>Status</Th>
                  <Th align="right">Actions</Th>
                </Tr>
              </THead>
              <TBody>
                {loading ? (
                  <TableEmpty colSpan={7}>Loading…</TableEmpty>
                ) : admins.length === 0 ? (
                  <TableEmpty colSpan={7}>No admin accounts yet</TableEmpty>
                ) : admins.map((admin) => (
                  <Tr key={admin.id}>
                    <Td emphasis="primary">
                      {admin.username}
                      {admin.deleted_at && <span style={{ color: 'var(--tone-danger-fg)', fontWeight: 500, fontSize: 'var(--text-xs)' }}> (deleted admin)</span>}
                    </Td>
                    <Td style={{ color: admin.email ? undefined : 'var(--tone-danger-fg)' }} emphasis={admin.email ? 'secondary' : undefined}>
                      {admin.email || '— (no alerts)'}
                    </Td>
                    <Td>{admin.role_title}</Td>
                    <Td emphasis="secondary" style={{ maxWidth: 200 }}>{formatPages(admin.page_permissions)}</Td>
                    <Td emphasis="secondary" mono>{admin.last_login_at ? new Date(admin.last_login_at).toLocaleDateString() : 'Never'}</Td>
                    <Td>
                      <StatusDot status={admin.is_active ? 'Active' : 'Inactive'} tone={admin.is_active ? 'success' : 'neutral'} />
                    </Td>
                    <Td align="right">
                      <AdminActions admin={admin} onEdit={openEdit} onToggle={handleToggleActive} onDelete={openDelete} />
                    </Td>
                  </Tr>
                ))}
              </TBody>
            </Table>
          </CardBody>
        </Card>
      )}

      <SidePanel
        open={!!panelMode}
        onClose={closePanel}
        title={panelMode === 'create' ? 'Create Admin Account' : 'Edit Admin Account'}
        footer={
          <Button variant="primary" onClick={handleSave} disabled={saving} style={{ width: '100%' }}>
            {saving ? 'Saving...' : panelMode === 'create' ? 'Create Account' : 'Save Changes'}
          </Button>
        }
      >
        <FieldShell label="Username">
          <Input value={username} onChange={(e) => setUsername(e.target.value)} disabled={panelMode === 'edit'} />
        </FieldShell>

        <FieldShell label={<>Email <span style={{ fontWeight: 400, textTransform: 'none', color: 'var(--fg-tertiary)' }}>(receives security alerts)</span></>}>
          <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="admin@cardelite.ng" />
        </FieldShell>

        <FieldShell label={<>Password {panelMode === 'edit' && <span style={{ fontWeight: 400, textTransform: 'none' }}>(leave blank to keep)</span>}</>}>
          <div style={{ position: 'relative' }}>
            <Input style={{ paddingRight: 36 }} type={showPassword ? 'text' : 'password'} value={password} onChange={(e) => setPassword(e.target.value)} />
            <button style={eyeBtn} type="button" onClick={() => setShowPassword(!showPassword)}>
              <EyeIcon visible={showPassword} />
            </button>
          </div>
        </FieldShell>

        <FieldShell label="Confirm Password">
          <div style={{ position: 'relative' }}>
            <Input style={{ paddingRight: 36 }} type={showConfirm ? 'text' : 'password'} value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} />
            <button style={eyeBtn} type="button" onClick={() => setShowConfirm(!showConfirm)}>
              <EyeIcon visible={showConfirm} />
            </button>
          </div>
        </FieldShell>

        <FieldShell label="Role Title">
          <Input placeholder="e.g. Card Reviewer" value={roleTitle} onChange={(e) => setRoleTitle(e.target.value)} />
        </FieldShell>

        <FieldShell label="Assigned Pages">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 4 }}>
            {ASSIGNABLE_PAGES.map((page) => {
              const checked = selectedPages.includes(page.key);
              return (
                <label key={page.key} style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                  <div
                    style={{
                      width: 16, height: 16, borderWidth: '1.5px', borderStyle: 'solid',
                      borderColor: checked ? 'var(--accent-base)' : 'var(--border-default)',
                      borderRadius: 3, backgroundColor: checked ? 'var(--accent-base)' : 'var(--bg-surface)',
                      display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, cursor: 'pointer',
                    }}
                    onClick={() => togglePage(page.key)}
                  >
                    {checked && <span style={{ fontSize: 10, color: 'var(--accent-fg)', fontWeight: 700 }}>✓</span>}
                  </div>
                  <span style={{ fontSize: 'var(--text-sm)', color: 'var(--fg-secondary)' }}>{page.label}</span>
                </label>
              );
            })}
          </div>
        </FieldShell>

        {formError && <p style={{ fontSize: 'var(--text-sm)', color: 'var(--tone-danger-fg)', margin: '8px 0' }}>{formError}</p>}
      </SidePanel>

      <Modal
        open={!!deleteTarget}
        onClose={() => { setDeleteTarget(null); setDeleteInput(''); setDeleteError(''); }}
        title="Delete Admin Account"
        subtitle={<>This action cannot be undone. Type <strong>DELETE</strong> to confirm.</>}
        size="sm"
        footer={
          <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
            <Button variant="secondary" onClick={() => { setDeleteTarget(null); setDeleteInput(''); setDeleteError(''); }}>Cancel</Button>
            <Button variant="danger" disabled={deleteInput !== 'DELETE'} onClick={handleDelete}>Delete</Button>
          </div>
        }
      >
        <Input placeholder="Type DELETE" value={deleteInput} onChange={(e) => setDeleteInput(e.target.value)} />
        {deleteError && <p style={{ color: 'var(--tone-danger-fg)', fontSize: 'var(--text-sm)', marginTop: 8 }}>{deleteError}</p>}
      </Modal>
    </div>
  );
}

const eyeBtn: React.CSSProperties = {
  position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)',
  background: 'none', border: 'none', cursor: 'pointer', padding: 0,
};

function EyeIcon({ visible }: { visible: boolean }) {
  return visible ? (
    <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="var(--fg-tertiary)" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
      <circle cx={12} cy={12} r={3} />
    </svg>
  ) : (
    <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="var(--fg-tertiary)" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
      <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
      <line x1={1} y1={1} x2={23} y2={23} />
    </svg>
  );
}
