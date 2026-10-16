'use client';

import { useResource, type UseResourceResult } from '../../_ui';
import { fetchQueue, type QueueListResult } from './queueApi';
import { queueParams, sameQueueTab, type QueueQuery } from './queueModel';

export function useQueueList(query: QueueQuery): UseResourceResult<QueueListResult> {
  const key = queueParams(query);
  return useResource(key, (signal) => fetchQueue(key, signal), { keepPreviousData: sameQueueTab });
}
