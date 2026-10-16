'use client';

import { useResource, type UseResourceResult } from '../../_ui';
import { fetchQueue, type QueueListResult } from './queueApi';
import { pollFor, queueParams, sameQueueTab, type QueueQuery } from './queueModel';

export function useQueueList(query: QueueQuery, paused: boolean, live: boolean): UseResourceResult<QueueListResult> {
  const key = queueParams(query);
  return useResource(key, (signal) => fetchQueue(key, signal), {
    pollMs: pollFor(live, paused),
    keepPreviousData: sameQueueTab,
  });
}
