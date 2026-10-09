'use client';

import { useEffect, useState } from 'react';
import { Copy, Download, Images, Mail, MessageCircle, Send, Share2 } from 'lucide-react';
import { Button, Menu, copyToClipboard, useToast } from '../../_ui';
import { apiRequest, type ApiBody, type ApiFailure } from '../../lib/apiClient';
import type { Submission } from './queueModel';

type ShareChannel = 'whatsapp' | 'telegram' | 'email' | 'copy' | 'native' | 'download';

interface SharePayload {
  text: string;
  subject: string;
  title: string;
  images: string[];
}

interface ShareCapabilities {
  share: boolean;
  download: boolean;
}

const NO_CAPABILITIES: ShareCapabilities = { share: false, download: false };

let capabilitiesRequest: Promise<ShareCapabilities> | null = null;

function toCapabilities(body: ApiBody): ShareCapabilities {
  return { share: body.share === true, download: body.download === true };
}

function toSharePayload(body: ApiBody): SharePayload {
  return {
    text: String(body.text ?? ''),
    subject: String(body.subject ?? ''),
    title: String(body.title ?? ''),
    images: Array.isArray(body.images) ? body.images.filter((u): u is string => typeof u === 'string') : [],
  };
}

function shareFailure(failure: ApiFailure): string {
  return failure.kind === 'http' && !failure.outcomeUnknown ? failure.message : '';
}

function loadCapabilities(): Promise<ShareCapabilities> {
  if (!capabilitiesRequest) {
    capabilitiesRequest = apiRequest('/api/card-queue/share', { select: toCapabilities }).then((result) => {
      if (result.ok) return result.data;
      if (result.error.kind !== 'http') capabilitiesRequest = null;
      return NO_CAPABILITIES;
    });
  }
  return capabilitiesRequest;
}

async function requestShare(submissionId: string, channel: ShareChannel): Promise<SharePayload> {
  const result = await apiRequest('/api/card-queue/share', {
    method: 'POST',
    body: { submission_id: submissionId, channel },
    select: toSharePayload,
  });
  if (!result.ok) throw new Error(shareFailure(result.error));
  return result.data;
}

async function fetchImage(url: string): Promise<Blob> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`the image request failed (${res.status})`);
  return res.blob();
}

function isAbort(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && (error as { name?: unknown }).name === 'AbortError');
}

function reason(error: unknown): string {
  return error instanceof Error && error.message ? error.message : '';
}

function openPendingTab(): Window | null {
  const tab = window.open('', '_blank');
  if (tab) tab.opener = null;
  return tab;
}

export function ShareMenu({ submission }: { submission: Submission }) {
  const { show: notify } = useToast();
  const [busy, setBusy] = useState(false);
  const [caps, setCaps] = useState<ShareCapabilities | null>(null);
  const hasImages = submission.card_images.length > 0;

  useEffect(() => {
    let alive = true;
    loadCapabilities().then((c) => { if (alive) setCaps(c); });
    return () => { alive = false; };
  }, []);

  const fail = (error: unknown, fallback: string) => {
    notify(reason(error) || fallback, 'error');
  };

  const shareToTab = async (channel: 'whatsapp' | 'telegram', build: (text: string) => string) => {
    const tab = openPendingTab();
    try {
      const payload = await requestShare(submission.id, channel);
      const url = build(payload.text);
      if (tab) tab.location.href = url;
      else if (!window.open(url, '_blank')) notify('Your browser blocked the new tab. Allow pop-ups for this site and try again.', 'warning');
    } catch (error) {
      tab?.close();
      fail(error, 'Sharing failed.');
    }
  };

  const shareToWhatsApp = () => shareToTab('whatsapp', (text) => `https://wa.me/?text=${encodeURIComponent(text)}`);

  const shareToTelegram = () => shareToTab('telegram', (text) => {
    const encoded = encodeURIComponent(text);
    return `https://t.me/share/url?url=${encoded}&text=${encoded}`;
  });

  const shareToEmail = async () => {
    try {
      const payload = await requestShare(submission.id, 'email');
      window.location.href = `mailto:?subject=${encodeURIComponent(payload.subject)}&body=${encodeURIComponent(payload.text)}`;
    } catch (error) {
      fail(error, 'Sharing failed.');
    }
  };

  const copyText = async () => {
    const pending = requestShare(submission.id, 'copy');
    try {
      if (typeof ClipboardItem !== 'undefined' && typeof navigator.clipboard?.write === 'function') {
        await navigator.clipboard.write([
          new ClipboardItem({
            'text/plain': pending.then((payload) => new Blob([payload.text], { type: 'text/plain' })),
          }),
        ]);
      } else {
        const payload = await pending;
        if (!(await copyToClipboard(payload.text))) throw new Error('The clipboard is not available in this browser.');
      }
      notify('Submission details copied to the clipboard.', 'success');
    } catch (error) {
      const serverError = await pending.then(() => null, (e: unknown) => e);
      fail(serverError ?? error, 'The details could not be copied.');
    }
  };

  const shareWithImages = async () => {
    if (typeof navigator.share !== 'function') {
      notify('This browser cannot share directly. Use Download images instead.', 'warning');
      return;
    }
    setBusy(true);
    try {
      const payload = await requestShare(submission.id, 'native');
      const files: File[] = [];
      for (let i = 0; i < payload.images.length; i++) {
        const blob = await fetchImage(payload.images[i]);
        const ext = (blob.type.split('/')[1] || 'jpg').split('+')[0];
        files.push(new File([blob], `card-${i + 1}.${ext}`, { type: blob.type || 'image/jpeg' }));
      }
      const data: ShareData = { text: payload.text, title: payload.title || 'Card Submission' };
      if (files.length > 0 && typeof navigator.canShare === 'function' && navigator.canShare({ files })) {
        data.files = files;
      } else if (files.length > 0) {
        notify('This browser cannot attach the images, so only the text was shared.', 'warning');
      }
      await navigator.share(data);
    } catch (error) {
      if (!isAbort(error)) fail(error, 'Share failed.');
    } finally {
      setBusy(false);
    }
  };

  const downloadImages = async () => {
    setBusy(true);
    try {
      const payload = await requestShare(submission.id, 'download');
      for (let i = 0; i < payload.images.length; i++) {
        const blob = await fetchImage(payload.images[i]);
        const href = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = href;
        link.download = `card-${i + 1}.${blob.type.split('/')[1] || 'jpg'}`;
        document.body.appendChild(link);
        link.click();
        link.remove();
        window.setTimeout(() => URL.revokeObjectURL(href), 1000);
      }
    } catch (error) {
      fail(error, 'The images could not be downloaded.');
    } finally {
      setBusy(false);
    }
  };

  if (!caps) return null;
  const canShare = caps.share;
  const canDownload = caps.download && hasImages;
  if (!canShare && !canDownload) return null;

  return (
    <Menu
      align="end"
      aria-label="Share submission"
      items={[
        canShare && hasImages && {
          label: 'Share with images (native)',
          icon: <Images size={14} />,
          onSelect: () => void shareWithImages(),
        },
        canShare && { label: 'WhatsApp (text only)', icon: <MessageCircle size={14} />, onSelect: () => void shareToWhatsApp() },
        canShare && { label: 'Telegram (text only)', icon: <Send size={14} />, onSelect: () => void shareToTelegram() },
        canShare && { label: 'Email (text only)', icon: <Mail size={14} />, onSelect: () => void shareToEmail() },
        canShare && { label: 'Copy text', icon: <Copy size={14} />, onSelect: () => void copyText() },
        canDownload && {
          label: 'Download images',
          icon: <Download size={14} />,
          onSelect: () => void downloadImages(),
        },
      ]}
      trigger={(props) => (
        <Button {...props} variant="secondary" size="sm" leftIcon={<Share2 size={14} />} loading={busy}>
          {canShare ? 'Share' : 'Download'}
        </Button>
      )}
    />
  );
}
