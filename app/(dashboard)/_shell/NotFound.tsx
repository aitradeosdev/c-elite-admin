'use client';

import Link from 'next/link';

export function AdminNotFound() {
  return (
    <div style={styles.wrap}>
      <div style={styles.code}>404</div>
      <h1 style={styles.title}>Page not found</h1>
      <p style={styles.body}>
        The page you're looking for doesn't exist, or you don't have permission to view it.
      </p>
      <Link href="/dashboard" style={styles.btn}>Back to Dashboard</Link>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  wrap: { padding: '64px 24px', textAlign: 'center', maxWidth: 480, margin: '0 auto' },
  code: { fontSize: 64, fontWeight: 800, color: 'var(--accent-base)', letterSpacing: -2, lineHeight: 1, marginBottom: 12 },
  title: { fontSize: 22, fontWeight: 800, color: 'var(--fg-primary)', margin: '0 0 10px' },
  body: { fontSize: 13, color: 'var(--fg-secondary)', lineHeight: 1.6, margin: '0 0 22px' },
  btn: {
    display: 'inline-block', padding: '10px 22px', fontSize: 13, fontWeight: 700,
    backgroundColor: 'var(--accent-base)', color: 'var(--accent-fg)',
    borderRadius: 100, textDecoration: 'none',
  },
};
