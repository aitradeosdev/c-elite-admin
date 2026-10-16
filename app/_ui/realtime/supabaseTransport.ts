import { createClient, type RealtimeChannel } from '@supabase/supabase-js';
import type { RealtimeTopic } from '../../lib/realtimePass';
import { SIGNAL_EVENT, type ChannelStatus, type SignalsTransport } from './signalsCore';

const CHANNEL_STATUSES: readonly ChannelStatus[] = ['SUBSCRIBED', 'TIMED_OUT', 'CHANNEL_ERROR', 'CLOSED'];

function openClient(url: string, key: string, currentPass: () => string) {
  return createClient(url, key, {
    accessToken: async () => currentPass(),
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}

type Client = ReturnType<typeof openClient>;

interface Subscription {
  readonly owner: Client;
  readonly channel: RealtimeChannel;
  active: boolean;
  removal: Promise<void> | null;
}

function channelStatus(value: string): ChannelStatus | null {
  return CHANNEL_STATUSES.find((status) => status === value) ?? null;
}

function reasonOf(error: unknown): string | null {
  if (error instanceof Error) return error.message === '' ? null : error.message;
  return typeof error === 'string' && error !== '' ? error : null;
}

function remove(subscription: Subscription): Promise<void> {
  if (!subscription.removal) {
    subscription.removal = subscription.owner.removeChannel(subscription.channel).then(
      () => undefined,
      () => undefined,
    );
  }
  return subscription.removal;
}

export function createSupabaseTransport(): SignalsTransport {
  let client: Client | null = null;
  let pass = '';
  const subscriptions = new Map<RealtimeTopic, Subscription>();

  return {
    async connect(url, key, token) {
      pass = token;
      const next = openClient(url, key, () => pass);
      client = next;
      await next.realtime.setAuth(token);
    },

    async setAuth(token) {
      pass = token;
      if (client) await client.realtime.setAuth(token);
    },

    join(topic, onMessage, onStatus) {
      const owner = client;
      if (!owner) throw new Error('The realtime transport is not connected.');
      const channel = owner.channel(topic, { config: { private: true, broadcast: { self: false, ack: false } } });
      const subscription: Subscription = { owner, channel, active: true, removal: null };
      subscriptions.set(topic, subscription);
      channel
        .on('broadcast', { event: SIGNAL_EVENT }, (message) => {
          if (subscription.active) onMessage(message.payload);
        })
        .subscribe((state, error) => {
          if (!subscription.active) return;
          const status = channelStatus(String(state));
          if (status === null) return;
          if (status !== 'SUBSCRIBED') {
            subscription.active = false;
            void remove(subscription);
          }
          onStatus(status, status === 'CHANNEL_ERROR' ? reasonOf(error) : null);
        });
    },

    async leave(topic) {
      const subscription = subscriptions.get(topic);
      if (!subscription) return;
      subscriptions.delete(topic);
      subscription.active = false;
      await remove(subscription);
    },

    async disconnect() {
      const owner = client;
      client = null;
      const pending = Array.from(subscriptions.values());
      subscriptions.clear();
      for (const subscription of pending) subscription.active = false;
      await Promise.all(pending.map(remove));
      if (!owner) return;
      try {
        await owner.removeAllChannels();
      } catch {}
      try {
        await owner.realtime.disconnect();
      } catch {}
    },
  };
}
