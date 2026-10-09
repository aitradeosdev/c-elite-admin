'use client';

import { useState, type ReactNode } from 'react';
import Link from 'next/link';
import { ExternalLink } from 'lucide-react';
import {
  Avatar, Button, DetailRow, ErrorState, ImageViewer, Money, Notice, Ref, SectionLabel, SidePanel, Skeleton, StatusDot,
  formatNaira,
} from '../../_ui';
import type { ApiFailure } from '../../lib/apiClient';
import { formatAge, formatBusinessDateTime } from '../../lib/time';
import { ShareMenu } from './ShareMenu';
import { cardName, formatForeignAmount, statusText, toKobo, userHandle, type Submission } from './queueModel';
import s from './SubmissionDrawer.module.css';

type ImageSet = 'card' | 'dispute';

interface ViewerState {
  submissionId: string;
  set: ImageSet;
  index: number;
}

export interface SubmissionDrawerProps {
  open: boolean;
  submission: Submission | null;
  retrying: boolean;
  error: ApiFailure | null;
  canReview: boolean;
  deciding: boolean;
  onClose: () => void;
  onRetry: () => void;
  onApprove: (submission: Submission) => void;
  onOverturn: (submission: Submission) => void;
  onReject: (submission: Submission) => void;
  onUphold: (submission: Submission) => void;
  returnFocusTo?: () => HTMLElement | null;
}

function fieldText(value: unknown): string {
  if (value === null || value === undefined || value === '') return '—';
  if (typeof value === 'string') return value;
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

function noteLabel(status: string): string {
  return status === 'approved' ? 'Note on record' : 'Rejection reason';
}

function Thumbnails({
  urls, label, onOpen,
}: { urls: string[]; label: string; onOpen: (index: number) => void }) {
  return (
    <div className={s.thumbs}>
      {urls.map((url, index) => (
        <button
          key={url}
          type="button"
          className={s.thumb}
          onClick={() => onOpen(index)}
          aria-label={`Open ${label} ${index + 1} of ${urls.length}`}
        >
          <img src={url} alt="" className={s.thumbImage} loading="lazy" />
        </button>
      ))}
    </div>
  );
}

function DrawerSkeleton() {
  return (
    <>
      <span className={s.srOnly} role="status">Loading submission</span>
      <div aria-hidden>
        <div className={s.toolbar}>
          <Skeleton width={180} height={14} />
          <Skeleton width={76} height={28} />
        </div>
        <div className={s.user}>
          <Skeleton width={40} height={40} rounded />
          <div className={s.userText}>
            <Skeleton width="46%" height={14} />
            <Skeleton width="62%" height={12} />
          </div>
        </div>
        <div className={s.section}>
          <Skeleton width={96} height={10} />
          {Array.from({ length: 9 }, (_, i) => (
            <div key={i} className={s.skeletonRow}>
              <Skeleton width="26%" height={12} />
              <Skeleton width={i % 2 ? '30%' : '38%'} height={12} />
            </div>
          ))}
        </div>
        <div className={s.section}>
          <Skeleton width={96} height={10} />
          <div className={s.thumbs}>
            {Array.from({ length: 3 }, (_, i) => <Skeleton key={i} height={88} />)}
          </div>
        </div>
      </div>
    </>
  );
}

function SubmissionBody({ submission, onOpenImage }: { submission: Submission; onOpenImage: (set: ImageSet, index: number) => void }) {
  const user = submission.users;
  const fields = Object.entries(submission.submitted_fields || {});
  const coupon = toKobo(submission.coupon_bonus);
  const hasCoupon = Boolean(submission.coupon_code) || (coupon !== null && coupon > BigInt(0));
  const rate = submission.rate_at_submission;
  const disputed = submission.status === 'disputed';
  const hasDispute = Boolean(submission.dispute_message) || submission.dispute_images.length > 0;

  return (
    <>
      <div className={s.toolbar}>
        <span className={s.idRow}>
          <span className={s.idLabel}>ID</span>
          <Ref value={submission.id} truncate={13} label="submission ID" size="sm" />
        </span>
        <ShareMenu submission={submission} />
      </div>

      <div className={s.user}>
        <Avatar name={user?.full_name || user?.username} size="lg" decorative />
        <div className={s.userText}>
          <p className={s.userName}>{user?.full_name || userHandle(user)}</p>
          {user?.email ? <p className={s.userMeta}>{user.email}</p> : null}
          {user?.username ? <p className={s.userMeta}>@{user.username}</p> : null}
        </div>
        {user?.id ? (
          <Link href={`/users/${user.id}`} target="_blank" rel="noopener" prefetch={false} className={s.userLink}>
            Profile
            <ExternalLink size={12} aria-hidden />
          </Link>
        ) : null}
      </div>

      <section className={s.section}>
        <SectionLabel>Submission</SectionLabel>
        <DetailRow label="Status" value={<StatusDot status={submission.status} label={statusText(submission.status)} />} />
        <DetailRow label="Card" value={cardName(submission)} />
        <DetailRow label="Type" value={submission.card_types?.name || '—'} />
        <DetailRow label="Country" value={submission.country_name || submission.card_types?.country_code || '—'} />
        <DetailRow label="Denomination" value={submission.denominations?.range_label || '—'} />
        <DetailRow label="Card value" value={formatForeignAmount(submission.amount_foreign, submission.currency_symbol)} mono />
        <DetailRow
          label="Rate"
          value={rate !== null && rate !== undefined && rate !== '' ? `${formatNaira(rate)} per unit` : '—'}
          mono
        />
        <DetailRow label="Payout" value={<Money value={submission.payout_naira} emphasis="strong" />} />
        {hasCoupon ? (
          <DetailRow
            label="Coupon"
            value={
              <span className={s.coupon}>
                <span className={s.couponCode}>{submission.coupon_code || '—'}</span>
                <Money value={submission.coupon_bonus} signed />
              </span>
            }
          />
        ) : null}
        <DetailRow
          label="Submitted"
          value={`${formatBusinessDateTime(submission.created_at)} · ${formatAge(submission.created_at)} ago`}
        />
      </section>

      {fields.length > 0 ? (
        <section className={s.section}>
          <SectionLabel>Submitted fields</SectionLabel>
          {fields.map(([key, value]) => (
            <DetailRow key={key} label={submission.field_labels[key] || key} value={fieldText(value)} mono wrap />
          ))}
        </section>
      ) : null}

      <section className={s.section}>
        <SectionLabel>Card images</SectionLabel>
        {submission.card_images.length > 0 ? (
          <Thumbnails urls={submission.card_images} label="card image" onOpen={(index) => onOpenImage('card', index)} />
        ) : (
          <p className={s.muted}>No card images were uploaded.</p>
        )}
      </section>

      {hasDispute ? (
        <section className={s.section}>
          <Notice variant="callout" tone={disputed ? 'warning' : 'neutral'} icon={null} title={disputed ? 'Open dispute' : 'Dispute'}>
            {submission.dispute_message || 'No message was given.'}
          </Notice>
          {submission.dispute_images.length > 0 ? (
            <div className={s.evidence}>
              <SectionLabel>Dispute evidence</SectionLabel>
              <Thumbnails urls={submission.dispute_images} label="dispute image" onOpen={(index) => onOpenImage('dispute', index)} />
            </div>
          ) : null}
        </section>
      ) : null}

      {submission.rejection_reason && submission.status !== 'pending' ? (
        <section className={s.section}>
          <SectionLabel>{noteLabel(submission.status)}</SectionLabel>
          <p className={s.note}>{submission.rejection_reason}</p>
        </section>
      ) : null}
    </>
  );
}

export function SubmissionDrawer({
  open, submission, retrying, error, canReview, deciding, onClose, onRetry, onApprove, onOverturn, onReject, onUphold,
  returnFocusTo,
}: SubmissionDrawerProps) {
  const [viewer, setViewer] = useState<ViewerState | null>(null);
  const [wasOpen, setWasOpen] = useState(open);
  if (wasOpen !== open) {
    setWasOpen(open);
    if (!open) setViewer(null);
  }
  const activeViewer = viewer && submission && viewer.submissionId === submission.id ? viewer : null;
  const viewerImages = activeViewer && submission
    ? (activeViewer.set === 'card' ? submission.card_images : submission.dispute_images)
    : [];

  let footer: ReactNode;
  if (submission && canReview && submission.status === 'pending') {
    footer = (
      <div className={s.footer}>
        <Button variant="dangerSubtle" disabled={deciding} onClick={() => onReject(submission)}>Reject</Button>
        <Button variant="success" disabled={deciding} onClick={() => onApprove(submission)}>Approve</Button>
      </div>
    );
  } else if (submission && canReview && submission.status === 'disputed') {
    footer = (
      <div className={s.footer}>
        <Button variant="dangerSubtle" disabled={deciding} onClick={() => onUphold(submission)}>Uphold rejection</Button>
        <Button variant="success" disabled={deciding} onClick={() => onOverturn(submission)}>Overturn</Button>
      </div>
    );
  }

  let content: ReactNode;
  if (submission) {
    content = (
      <SubmissionBody
        submission={submission}
        onOpenImage={(set, index) => setViewer({ submissionId: submission.id, set, index })}
      />
    );
  } else if (error) {
    content = error.status === 404 ? (
      <ErrorState
        compact
        title="Submission not found"
        message="This submission does not exist or was removed. Check the link you followed."
        requestId={error.requestId}
      />
    ) : (
      <ErrorState
        compact
        title="This submission could not be loaded"
        message={error.message}
        requestId={error.requestId}
        onRetry={onRetry}
        retrying={retrying}
      />
    );
  } else {
    content = <DrawerSkeleton />;
  }

  return (
    <>
      <SidePanel
        open={open}
        onClose={onClose}
        title="Card submission"
        subtitle={submission ? `${userHandle(submission.users)} · ${cardName(submission)}` : undefined}
        footer={footer}
        returnFocusTo={returnFocusTo}
      >
        {content}
      </SidePanel>
      <ImageViewer
        open={open && viewerImages.length > 0}
        images={viewerImages}
        index={activeViewer?.index ?? 0}
        onIndexChange={(index) => setViewer((v) => (v ? { ...v, index } : v))}
        onClose={() => setViewer(null)}
        title={activeViewer?.set === 'dispute' ? 'Dispute evidence' : `${submission ? cardName(submission) : 'Card'} images`}
      />
    </>
  );
}
