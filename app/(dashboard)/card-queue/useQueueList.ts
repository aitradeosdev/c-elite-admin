'use client';

import { useResource, type UseResourceResult } from '../../_ui';
import { fetchQueue, type QueueListResult } from './queueApi';
import { POLL_MS, queueParams, sameQueueTab, type QueueQuery } from './queueModel';

export function useQueueList(query: QueueQuery, paused: boolean): UseResourceResult<QueueListResult> {
  const key = queueParams(query);
  return useResource(key, (signal) => fetchQueue(key, signal), {
    pollMs: paused ? 0 : POLL_MS,
    keepPreviousData: sameQueueTab,
  });
}
