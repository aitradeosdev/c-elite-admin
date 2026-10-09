'use client';

import { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { AlertTriangle, Eye, EyeOff, Loader2 } from 'lucide-react';
import { ThemeSwitcher } from '../_ui/ThemeSwitcher';
import s from './login.module.css';

type FieldName = 'email' | 'username' | 'password';

function safeNext(raw: string | null): string {
  if (!raw) return '/dashboard';
  if (!raw.startsWith('/') || raw.startsWith('//')) return '/dashboard';
  if (raw.startsWith('/login')) return '/dashboard';
  return raw;
}

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const next = safeNext(searchParams.get('next'));

  const [email, setEmail] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [touched, setTouched] = useState<Record<FieldName, boolean>>({
    email: false,
    username: false,
    password: false,
  });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const emailRef = useRef<HTMLInputElement>(null);

  useEffect(() => { emailRef.current?.focus(); }, []);

  const fieldError = (name: FieldName): string | null => {
    if (!touched[name]) return null;
    if (name === 'email') {
      if (!email.trim()) return 'Enter your admin email.';
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) return 'That does not look like an email address.';
      return null;
    }
    if (name === 'username') return username.trim() ? null : 'Enter your admin username.';
    return password ? null : 'Enter your password.';
  };

  const markTouched = (name: FieldName) => setTouched((t) => ({ ...t, [name]: true }));

  const complete = Boolean(email.trim() && username.trim() && password);

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      setTouched({ email: true, username: true, password: true });
      if (!complete || loading) return;

      setLoading(true);
      setError('');
      try {
        const res = await fetch('/api/auth', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: email.trim(), username: username.trim(), password }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          setError(
            data?.error ||
              (res.status === 429
                ? 'Too many attempts. Wait a few minutes and try again.'
                : 'Sign in failed. Check your details and try again.'),
          );
          return;
        }
        router.push(next);
      } catch {
        setError('Could not reach the server. Check your connection and try again.');
      } finally {
        setLoading(false);
      }
    },
    [complete, loading, email, username, password, router, next],
  );

  return (
    <main className={s.page}>
      <div className={s.themeSlot}>
        <ThemeSwitcher />
      </div>

      <section className={s.panel} aria-labelledby="login-heading">
        <header className={s.head}>
          <span className={s.mark} aria-hidden>CE</span>
          <div className={s.headText}>
            <h1 id="login-heading" className={s.wordmark}>CardElite</h1>
            <p className={s.kicker}>Admin console</p>
          </div>
        </header>

        <form onSubmit={handleSubmit} noValidate>
          <div className={s.field}>
            <label className={s.label} htmlFor="login-email">Email</label>
            <input
              id="login-email"
              ref={emailRef}
              className={[s.input, fieldError('email') && s.inputInvalid].filter(Boolean).join(' ')}
              type="email"
              inputMode="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              onBlur={() => markTouched('email')}
              autoComplete="email"
              autoCapitalize="none"
              spellCheck={false}
              disabled={loading}
              aria-invalid={!!fieldError('email') || undefined}
              aria-describedby={fieldError('email') ? 'login-email-error' : undefined}
            />
            {fieldError('email') ? (
              <p id="login-email-error" className={s.fieldError}>{fieldError('email')}</p>
            ) : null}
          </div>

          <div className={s.field}>
            <label className={s.label} htmlFor="login-username">Username</label>
            <input
              id="login-username"
              className={[s.input, fieldError('username') && s.inputInvalid].filter(Boolean).join(' ')}
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              onBlur={() => markTouched('username')}
              autoComplete="username"
              autoCapitalize="none"
              spellCheck={false}
              disabled={loading}
              aria-invalid={!!fieldError('username') || undefined}
              aria-describedby={fieldError('username') ? 'login-username-error' : undefined}
            />
            {fieldError('username') ? (
              <p id="login-username-error" className={s.fieldError}>{fieldError('username')}</p>
            ) : null}
          </div>

          <div className={s.field}>
            <label className={s.label} htmlFor="login-password">Password</label>
            <div className={s.passwordWrap}>
              <input
                id="login-password"
                className={[s.input, s.inputWithAffix, fieldError('password') && s.inputInvalid].filter(Boolean).join(' ')}
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                onBlur={() => markTouched('password')}
                autoComplete="current-password"
                disabled={loading}
                aria-invalid={!!fieldError('password') || undefined}
                aria-describedby={fieldError('password') ? 'login-password-error' : undefined}
              />
              <button
                type="button"
                className={s.affixBtn}
                onClick={() => setShowPassword((v) => !v)}
                aria-label={showPassword ? 'Hide password' : 'Show password'}
                aria-pressed={showPassword}
                title={showPassword ? 'Hide password' : 'Show password'}
                tabIndex={0}
              >
                {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
            {fieldError('password') ? (
              <p id="login-password-error" className={s.fieldError}>{fieldError('password')}</p>
            ) : null}
          </div>

          {error ? (
            <div className={s.formError} role="alert">
              <AlertTriangle size={15} className={s.formErrorIcon} />
              <span>{error}</span>
            </div>
          ) : null}

          <button type="submit" className={s.submit} disabled={loading}>
            {loading ? (
              <>
                <Loader2 size={15} className={s.spin} />
                <span>Signing in…</span>
              </>
            ) : (
              <span>Sign in</span>
            )}
          </button>
        </form>

        <p className={s.foot}>
          Admin access is granted by a super administrator. Every sign-in attempt is recorded.
        </p>
      </section>
    </main>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={<main className={s.page} />}>
      <LoginForm />
    </Suspense>
  );
}
