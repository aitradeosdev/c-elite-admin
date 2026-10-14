'use client';

import { useEffect, useTransition } from 'react';
import { ErrorState } from './_ui/States';

export default function RootError({
  error,
  unstable_retry,
}: {
  error: Error & { digest?: string };
  unstable_retry: () => void;
}) {
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    console.error('root segment error:', error);
  }, [error]);

  return (
    <main>
      <ErrorState
        title="Something went wrong"
        message="We couldn't load this page. Try again in a moment."
        requestId={error.digest || null}
        detail={process.env.NODE_ENV === 'development' ? error.message : null}
        onRetry={() => startTransition(unstable_retry)}
        retrying={pending}
      />
    </main>
  );
}
