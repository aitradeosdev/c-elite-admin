'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

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
}

type PanelMode = 'create' | 'edit' | null;

export default function AdminAccountsPage() {
  const router = useRouter();
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

  useEffect(() => {
    fetchAdmins();
  }, []);

  const fetchAdmins = async () => {
    setLoading(true);
    const res = await fetch('/api/admin-accounts');
    if (res.status === 403) { router.push('/dashboard'); return; }
    const data = await res.json();
    setAdmins(data.admins || []);
    setLoading(false);
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
    fetchAdmins();
  };

  const handleToggleActive = async (admin: AdminUser) => {
    await fetch('/api/admin-accounts', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: admin.id, is_active: !admin.is_active }),
    });
    fetchAdmins();
  };

  const handleDelete = async () => {
    if (!deleteTarget || deleteInput !== 'DELETE') return;
    await fetch('/api/admin-accounts', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: deleteTarget.id }),
    });
    setDeleteTarget(null);
    setDeleteInput('');
    fetchAdmins();
  };

  const formatPages = (pages: string[]) => {
    if (!pages || pages.length === 0) return '-';
    const labels = pages.map((p) => ASSIGNABLE_PAGES.find((a) => a.key === p)?.label || p);
    if (labels.length <= 3) return labels.join(', ');
    return labels.slice(0, 3).join(', ') + '...';
  };

  return (
    <div style={styles.page}>
      <div style={styles.header}>
        <span style={styles.title}>Admin Accounts</span>
        <button style={styles.createBtn} onClick={openCreate}>+ Create Admin</button>
      </div>

      <div style={styles.tableWrapper}>
        <table style={styles.table}>
          <thead>
            <tr>
              {['Username', 'Email', 'Role Title', 'Assigned Pages', 'Last Login', 'Status', 'Actions'].map((col) => (
                <th key={col} style={styles.th}>{col}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={7} style={{ ...styles.td, textAlign: 'center', color: '#888888' }}>Loading...</td></tr>
            ) : admins.length === 0 ? (
              <tr><td colSpan={7} style={{ ...styles.td, textAlign: 'center', color: '#888888' }}>No admin accounts yet</td></tr>
            ) : admins.map((admin, i) => (
              <tr key={admin.id} style={{ backgroundColor: i % 2 === 0 ? '#FFFFFF' : '#F7F7F7' }}>
                <td style={{ ...styles.td, fontWeight: 600 }}>{admin.username}</td>
                <td style={{ ...styles.td, color: admin.email ? '#333' : '#C62828' }}>{admin.email || '— (no alerts)'}</td>
                <td style={styles.td}>{admin.role_title}</td>
                <td style={{ ...styles.td, maxWidth: 200, color: '#555555' }}>{formatPages(admin.page_permissions)}</td>
                <td style={styles.td}>{admin.last_login_at ? new Date(admin.last_login_at).toLocaleDateString() : 'Never'}</td>
                <td style={styles.td}>
                  <span style={admin.is_active ? styles.badgeActive : styles.badgeInactive}>
                    {admin.is_active ? 'Active' : 'Inactive'}
                  </span>
                </td>
                <td style={styles.td}>
                  <div style={styles.actions}>
                    {!admin.is_super_admin && (
                      <>
                        <button style={styles.editBtn} onClick={() => openEdit(admin)}>Edit</button>
                        <button style={styles.deactivateBtn} onClick={() => handleToggleActive(admin)}>
                          {admin.is_active ? 'Deactivate' : 'Reactivate'}
                        </button>
                        {!admin.is_active && (
                          <button style={styles.deleteBtn} onClick={() => { setDeleteTarget(admin); setDeleteInput(''); }}>Delete</button>
                        )}
                      </>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {panelMode && (
        <>
          <div style={styles.overlay} onClick={closePanel} />
          <div style={styles.panel}>
            <p style={styles.panelTitle}>{panelMode === 'create' ? 'Create Admin Account' : 'Edit Admin Account'}</p>

            <div style={styles.fieldGroup}>
              <label style={styles.fieldLabel}>USERNAME</label>
              <input style={styles.input} value={username} onChange={(e) => setUsername(e.target.value)} disabled={panelMode === 'edit'} />
            </div>

            <div style={styles.fieldGroup}>
              <label style={styles.fieldLabel}>EMAIL <span style={{ fontWeight: 400, textTransform: 'none', color: '#888' }}>(receives security alerts)</span></label>
              <input style={styles.input} type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="admin@cardelite.ng" />
            </div>

            <div style={styles.fieldGroup}>
              <label style={styles.fieldLabel}>PASSWORD {panelMode === 'edit' && <span style={{ fontWeight: 400, textTransform: 'none' }}>(leave blank to keep)</span>}</label>
              <div style={styles.pwWrapper}>
                <input style={{ ...styles.input, paddingRight: 36 }} type={showPassword ? 'text' : 'password'} value={password} onChange={(e) => setPassword(e.target.value)} />
                <button style={styles.eyeBtn} type="button" onClick={() => setShowPassword(!showPassword)}>
                  <EyeIcon visible={showPassword} />
                </button>
              </div>
            </div>

            <div style={styles.fieldGroup}>
              <label style={styles.fieldLabel}>CONFIRM PASSWORD</label>
              <div style={styles.pwWrapper}>
                <input style={{ ...styles.input, paddingRight: 36 }} type={showConfirm ? 'text' : 'password'} value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} />
                <button style={styles.eyeBtn} type="button" onClick={() => setShowConfirm(!showConfirm)}>
                  <EyeIcon visible={showConfirm} />
                </button>
              </div>
            </div>

            <div style={styles.fieldGroup}>
              <label style={styles.fieldLabel}>ROLE TITLE</label>
              <input style={styles.input} placeholder="e.g. Card Reviewer" value={roleTitle} onChange={(e) => setRoleTitle(e.target.value)} />
            </div>

            <div style={styles.fieldGroup}>
              <label style={styles.fieldLabel}>ASSIGNED PAGES</label>
              <div style={styles.checkList}>
                {ASSIGNABLE_PAGES.map((page) => (
                  <label key={page.key} style={styles.checkRow}>
                    <div
                      style={{ ...styles.checkbox, ...(selectedPages.includes(page.key) ? styles.checkboxChecked : {}) }}
                      onClick={() => togglePage(page.key)}
                    >
                      {selectedPages.includes(page.key) && <span style={styles.checkmark}>✓</span>}
                    </div>
                    <span style={styles.checkLabel}>{page.label}</span>
                  </label>
                ))}
              </div>
            </div>

            {formError && <p style={styles.formError}>{formError}</p>}

            <button style={styles.saveBtn} onClick={handleSave} disabled={saving}>
              {saving ? 'Saving...' : panelMode === 'create' ? 'Create Account' : 'Save Changes'}
            </button>
          </div>
        </>
      )}

      {deleteTarget && (
        <>
          <div style={styles.modalOverlay} />
          <div style={styles.modal}>
            <p style={styles.modalTitle}>Delete Admin Account</p>
            <p style={styles.modalText}>This action cannot be undone. Type <strong>DELETE</strong> to confirm.</p>
            <input
              style={styles.input}
              placeholder="Type DELETE"
              value={deleteInput}
              onChange={(e) => setDeleteInput(e.target.value)}
            />
            <div style={styles.modalActions}>
              <button style={styles.modalCancelBtn} onClick={() => { setDeleteTarget(null); setDeleteInput(''); }}>Cancel</button>
              <button
                style={{ ...styles.deleteBtn, opacity: deleteInput !== 'DELETE' ? 0.5 : 1, padding: '8px 20px' }}
                disabled={deleteInput !== 'DELETE'}
                onClick={handleDelete}
              >
                Delete
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function EyeIcon({ visible }: { visible: boolean }) {
  return visible ? (
    <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="#888888" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
      <circle cx={12} cy={12} r={3} />
    </svg>
  ) : (
    <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="#888888" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
      <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
      <line x1={1} y1={1} x2={23} y2={23} />
    </svg>
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
  badgeActive: { backgroundColor: '#E8F5E9', color: '#2E7D32', padding: '3px 8px', borderRadius: 100, fontSize: 11, fontWeight: 600 },
  badgeInactive: { backgroundColor: '#EBEBEB', color: '#888888', padding: '3px 8px', borderRadius: 100, fontSize: 11, fontWeight: 600 },
  actions: { display: 'flex', gap: 6 },
  editBtn: { backgroundColor: '#F3E5F5', color: '#6A1B9A', border: 'none', borderRadius: 6, padding: '4px 10px', fontSize: 11, fontWeight: 600, cursor: 'pointer' },
  deactivateBtn: { backgroundColor: '#FFF8E1', color: '#F9A825', border: 'none', borderRadius: 6, padding: '4px 10px', fontSize: 11, fontWeight: 600, cursor: 'pointer' },
  deleteBtn: { backgroundColor: '#FFEBEE', color: '#C62828', border: 'none', borderRadius: 6, padding: '4px 10px', fontSize: 11, fontWeight: 600, cursor: 'pointer' },
  overlay: { position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.2)', zIndex: 49 },
  panel: { position: 'fixed', top: 0, right: 0, bottom: 0, width: 400, backgroundColor: '#FFFFFF', borderLeft: '1px solid #EEEEEE', padding: 24, zIndex: 50, overflowY: 'auto' },
  panelTitle: { fontSize: 15, fontWeight: 800, color: '#111111', margin: '0 0 20px' },
  fieldGroup: { marginBottom: 14 },
  fieldLabel: { display: 'block', fontSize: 11, fontWeight: 600, color: '#888888', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 4 },
  input: { width: '100%', border: '1.5px solid #E8E8E8', borderRadius: 8, padding: '10px 14px', fontSize: 13, color: '#111111', outline: 'none', boxSizing: 'border-box', backgroundColor: '#FFFFFF' },
  pwWrapper: { position: 'relative' },
  eyeBtn: { position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', padding: 0 },
  checkList: { display: 'flex', flexDirection: 'column', gap: 8, marginTop: 4 },
  checkRow: { display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' },
  checkbox: { width: 16, height: 16, borderWidth: '1.5px', borderStyle: 'solid', borderColor: '#DEDEDE', borderRadius: 3, backgroundColor: '#FFFFFF', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, cursor: 'pointer' },
  checkboxChecked: { backgroundColor: '#111111', borderColor: '#111111' },
  checkmark: { fontSize: 10, color: '#FFFFFF', fontWeight: 700 },
  checkLabel: { fontSize: 12, color: '#333333' },
  formError: { fontSize: 12, color: '#E53935', margin: '8px 0' },
  saveBtn: { width: '100%', backgroundColor: '#111111', color: '#FFFFFF', border: 'none', borderRadius: 100, padding: 12, fontSize: 12, fontWeight: 700, cursor: 'pointer', marginTop: 16 },
  modalOverlay: { position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.4)', zIndex: 99 },
  modal: { position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%,-50%)', backgroundColor: '#FFFFFF', borderRadius: 12, padding: 24, width: 360, zIndex: 100 },
  modalTitle: { fontSize: 15, fontWeight: 800, color: '#111111', margin: '0 0 8px' },
  modalText: { fontSize: 13, color: '#555555', margin: '0 0 16px' },
  modalActions: { display: 'flex', gap: 10, marginTop: 16, justifyContent: 'flex-end' },
  modalCancelBtn: { backgroundColor: '#F7F7F7', color: '#333333', border: 'none', borderRadius: 8, padding: '8px 20px', fontSize: 13, fontWeight: 600, cursor: 'pointer' },
};
