'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

function EyeIcon({ visible }: { visible: boolean }) {
  return visible ? (
    <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="#888888" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
      <circle cx={12} cy={12} r={3} />
    </svg>
  ) : (
    <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="#888888" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
      <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
      <line x1={1} y1={1} x2={23} y2={23} />
    </svg>
  );
}

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !username || !password || loading) return;
    setLoading(true);
    setError('');

    const res = await fetch('/api/auth', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, username, password }),
    });

    const data = await res.json();
    setLoading(false);

    if (!res.ok) {
      setError(data.error || 'Login failed');
      return;
    }

    router.push('/dashboard');
  };

  return (
    <div style={styles.page}>
      <div style={styles.card}>
        <p style={styles.wordmark}>CardElite</p>
        <p style={styles.adminLabel}>Admin Panel</p>
        <div style={styles.divider} />

        <form onSubmit={handleSubmit}>
          <div style={styles.fieldGroup}>
            <label style={styles.label}>EMAIL</label>
            <input
              style={styles.input}
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
            />
          </div>

          <div style={styles.fieldGroup}>
            <label style={styles.label}>USERNAME</label>
            <input
              style={styles.input}
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete="username"
            />
          </div>

          <div style={styles.fieldGroup}>
            <label style={styles.label}>PASSWORD</label>
            <div style={styles.passwordWrapper}>
              <input
                style={{ ...styles.input, paddingRight: 40 }}
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
              />
              <button
                type="button"
                style={styles.eyeBtn}
                onClick={() => setShowPassword(!showPassword)}
              >
                <EyeIcon visible={showPassword} />
              </button>
            </div>
          </div>

          {error && <p style={styles.error}>{error}</p>}

          <button
            type="submit"
            style={{ ...styles.loginBtn, opacity: loading ? 0.7 : 1 }}
            disabled={loading}
          >
            {loading ? 'Logging in...' : 'Login'}
          </button>
        </form>
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  page: {
    minHeight: '100vh',
    backgroundColor: '#F7F7F7',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  card: {
    width: 400,
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    padding: 32,
    boxShadow: '0 2px 16px rgba(0,0,0,0.08)',
  },
  wordmark: {
    fontSize: 20,
    fontWeight: 800,
    color: '#111111',
    textAlign: 'center',
    margin: 0,
  },
  adminLabel: {
    fontSize: 12,
    color: '#888888',
    textAlign: 'center',
    margin: '4px 0 0',
  },
  divider: {
    height: 1,
    backgroundColor: '#EEEEEE',
    margin: '0 0 24px',
  },
  fieldGroup: {
    marginBottom: 14,
  },
  label: {
    display: 'block',
    fontSize: 11,
    fontWeight: 600,
    color: '#333333',
    letterSpacing: '0.04em',
    textTransform: 'uppercase',
    marginBottom: 4,
  },
  input: {
    width: '100%',
    backgroundColor: '#FFFFFF',
    border: '1.5px solid #E8E8E8',
    borderRadius: 8,
    padding: '10px 14px',
    fontSize: 13,
    color: '#111111',
    outline: 'none',
    boxSizing: 'border-box',
  },
  passwordWrapper: {
    position: 'relative',
  },
  eyeBtn: {
    position: 'absolute',
    right: 10,
    top: '50%',
    transform: 'translateY(-50%)',
    background: 'none',
    border: 'none',
    cursor: 'pointer',
    fontSize: 14,
    padding: 0,
  },
  loginBtn: {
    width: '100%',
    backgroundColor: '#111111',
    color: '#FFFFFF',
    border: 'none',
    borderRadius: 8,
    padding: 12,
    fontSize: 14,
    fontWeight: 700,
    cursor: 'pointer',
    marginTop: 8,
  },
  error: {
    fontSize: 12,
    color: '#E53935',
    textAlign: 'center',
    marginTop: 8,
  },
};
