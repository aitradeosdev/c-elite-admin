'use client';

import { useCallback, useEffect, useRef, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { RotateCw } from 'lucide-react';
import { Button, ErrorState, useToast } from '../../_ui';

export function useServerRefresh(failing: boolean, stillFailingMessage: string) {
  const router = useRouter();
  const { show } = useToast();
  const [pending, startTransition] = useTransition();
  const requested = useRef(false);

  useEffect(() => {
    if (pending || !requested.current) return;
    requested.current = false;
    if (failing) show(stillFailingMessage, 'error');
  }, [pending, failing, stillFailingMessage, show]);

  const refresh = useCallback(() => {
    if (pending) return;
    requested.current = true;
    startTransition(() => {
      router.refresh();
    });
  }, [pending, router]);

  return { pending, refresh };
}

export function RefreshButton() {
  const { pending, refresh } = useServerRefresh(false, '');
  return (
    <Button
      variant="secondary"
      size="sm"
      leftIcon={<RotateCw size={14} />}
      loading={pending}
      onClick={refresh}
    >
      Refresh
    </Button>
  );
}

export interface RetryStateProps {
  title: string;
  message: string;
  stillFailing: string;
}

export function RetryState({ title, message, stillFailing }: RetryStateProps) {
  const { pending, refresh } = useServerRefresh(true, stillFailing);
  return <ErrorState compact title={title} message={message} onRetry={refresh} retrying={pending} />;
}
