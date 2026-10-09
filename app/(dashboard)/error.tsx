'use client';

import { useEffect } from 'react';
import { ErrorState } from '../_ui/States';

export default function DashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('dashboard segment error:', error);
  }, [error]);

  return (
    <ErrorState
      title="Something went wrong"
      message="We couldn't load this section. This has been logged."
      requestId={error.digest || null}
      detail={process.env.NODE_ENV === 'development' ? error.message : null}
      onRetry={reset}
      backHref="/dashboard"
    />
  );
}
