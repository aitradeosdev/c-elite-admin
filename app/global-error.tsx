'use client';

import { useEffect } from 'react';

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('global error:', error);
  }, [error]);

  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: '#FAFAF9',
          color: '#131316',
          fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
        }}
      >
        <div style={{ maxWidth: 440, padding: '48px 24px', textAlign: 'center' }}>
          <div
            style={{
              width: 48,
              height: 48,
              borderRadius: 12,
              margin: '0 auto 16px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              background: '#FCE9E9',
              color: '#A11B1B',
              fontSize: 22,
              fontWeight: 700,
            }}
            aria-hidden
          >
            !
          </div>
          <h1 style={{ fontSize: 20, fontWeight: 700, margin: '0 0 8px' }}>
            CardElite Admin could not start
          </h1>
          <p style={{ fontSize: 14, lineHeight: 1.6, color: '#57575A', margin: '0 0 8px' }}>
            The application hit an error before it could render. Reload to try again.
          </p>
          {error.digest ? (
            <p style={{ fontSize: 12, color: '#8A8A8E', margin: '0 0 20px' }}>
              Request ID{' '}
              <code style={{ fontFamily: 'ui-monospace, monospace' }}>{error.digest}</code>
            </p>
          ) : null}
          <button
            type="button"
            onClick={reset}
            style={{
              padding: '9px 20px',
              fontSize: 14,
              fontWeight: 600,
              color: '#FFFFFF',
              background: '#5B5BD6',
              border: 'none',
              borderRadius: 6,
              cursor: 'pointer',
            }}
          >
            Reload
          </button>
        </div>
      </body>
    </html>
  );
}
