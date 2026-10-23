'use client';

import Link from 'next/link';
import { AlertTriangle, ArrowUpRight } from 'lucide-react';
import { Badge, DetailRow, JsonViewer, Notice, Ref, SectionLabel, Skeleton, StatusDot } from '../../_ui';
import {
  JSON_MASK_KEYS, actionDescription, actionLabel, entityLabel, formatStamp, isSystemEvent, resultKind, resultLabel,
  resultTone, sensitivityLabel,
  type ActivityEvent,
} from './rules';
import { actorName, ageText, hasRecordedValue } from './model';
import s from './page.module.css';

type AdminFields = Pick<ActivityEvent, 'admin_id' | 'admin_username' | 'admin_is_super' | 'admin_deleted' | 'action'>;

export function AdminName({ event }: { event: AdminFields }) {
  const named = Boolean(event.admin_username) || isSystemEvent(event);
  return (
    <span className={s.adminName}>
      <span className={named ? s.lead : [s.lead, s.muted].join(' ')}>
        {actorName(event)}
      </span>
      {event.admin_is_super ? <Badge tone="neutral">Super</Badge> : null}
      {event.admin_deleted ? <Badge tone="neutral">Deleted</Badge> : null}
    </span>
  );
}

export function ResultDot({ value }: { value: string | null }) {
  return <StatusDot status={value ?? 'unrecorded'} tone={resultTone(value)} label={resultLabel(value)} />;
}

function OutcomeCallout({ event }: { event: ActivityEvent }) {
  const kind = resultKind(event.result);
  if (kind !== 'failure' && kind !== 'partial') return null;
  return (
    <Notice
      variant="callout"
      tone={kind === 'failure' ? 'danger' : 'warning'}
      icon={<AlertTriangle size={14} aria-hidden />}
      title={kind === 'failure' ? 'This action did not complete' : 'This action only partly completed'}
    >
      {event.error || 'No error message was recorded with this event.'}
    </Notice>
  );
}

function ChangeValue({ eventId, value, label }: { eventId: string; value: unknown; label: string }) {
  if (!hasRecordedValue(value)) {
    return <p className={s.none}>No {label.toLowerCase()} value was recorded.</p>;
  }
  return (
    <JsonViewer
      key={`${eventId}-${label}`}
      value={value}
      label={label}
      defaultExpandDepth={2}
      maskKeys={JSON_MASK_KEYS}
      maxHeight={320}
      copyable
    />
  );
}

export function EventDetail({ event, userHref }: { event: ActivityEvent; userHref: string | null }) {
  const kind = resultKind(event.result);
  const outcomeShown = kind === 'failure' || kind === 'partial';
  const sensitivity = sensitivityLabel(event.sensitivity);
  const roleChanged = Boolean(event.admin_role_title && event.admin_role && event.admin_role_title !== event.admin_role);
  const recorded = hasRecordedValue(event.before_value) || hasRecordedValue(event.after_value);
  const entity = entityLabel(event.entity);
  const tracked = event.result !== null;
  const description = actionDescription(event);

  return (
    <div className={s.detail}>
      <OutcomeCallout event={event} />

      <div className={s.section}>
        <SectionLabel>Event</SectionLabel>
        <DetailRow
          label="Action"
          wrap
          value={
            <span className={s.stackEnd}>
              <span>{actionLabel(event.action)}</span>
              <span className={s.subMono}>{event.action || '—'}</span>
            </span>
          }
        />
        {description ? <DetailRow label="Summary" wrap value={description} /> : null}
        <DetailRow label="Result" value={<ResultDot value={event.result} />} />
        <DetailRow label="Sensitivity" value={sensitivity ?? 'Not recorded'} />
        <DetailRow
          label="Recorded"
          wrap
          value={`${formatStamp(event.created_at)} WAT · ${ageText(event.created_at)}`}
        />
        <DetailRow label="Reason" wrap value={event.reason || (tracked ? 'None given' : 'Not recorded')} />
        {event.error && !outcomeShown ? <DetailRow label="Error" wrap value={event.error} /> : null}
      </div>

      <div className={s.section}>
        <SectionLabel>Administrator</SectionLabel>
        <DetailRow label="Admin" value={<AdminName event={event} />} />
        <DetailRow label="Role at the time" wrap value={event.admin_role || 'Not recorded'} />
        {roleChanged ? <DetailRow label="Current role" wrap value={event.admin_role_title} /> : null}
        <DetailRow label="Admin ID" value={<Ref value={event.admin_id} label="admin ID" truncate={13} />} />
      </div>

      <div className={s.section}>
        <div className={s.sectionHead}>
          <SectionLabel flush>Target</SectionLabel>
          {userHref ? (
            <Link href={userHref} className={s.sideLink}>
              View user <ArrowUpRight size={12} aria-hidden />
            </Link>
          ) : null}
        </div>
        <DetailRow label="Record type" wrap value={entity || '—'} />
        <DetailRow label="Record ID" value={<Ref value={event.entity_id} label="record ID" truncate={18} />} />
        {event.target_label ? <DetailRow label="Target" wrap value={event.target_label} /> : null}
        {event.target_username ? <DetailRow label="User" wrap value={`@${event.target_username}`} /> : null}
        {event.user_id ? (
          <DetailRow label="User ID" value={<Ref value={event.user_id} label="user ID" truncate={13} />} />
        ) : null}
      </div>

      <div className={s.section}>
        <SectionLabel>Request</SectionLabel>
        <DetailRow
          label="IP address"
          value={<Ref value={event.ip_address} label="IP address" truncate={40} />}
        />
        <DetailRow label="User agent" wrap value={event.user_agent || 'Not recorded'} />
        <DetailRow label="Request ID" value={<Ref value={event.request_id} label="request ID" truncate={24} />} />
        <DetailRow label="Audit ID" value={<Ref value={event.id} label="audit ID" truncate={13} />} />
      </div>

      <div className={s.section}>
        <SectionLabel>Changes</SectionLabel>
        {recorded ? (
          <div className={s.changes}>
            <ChangeValue eventId={event.id} value={event.before_value} label="Before" />
            <ChangeValue eventId={event.id} value={event.after_value} label="After" />
          </div>
        ) : (
          <p className={s.none}>No before or after values were recorded for this action.</p>
        )}
      </div>
    </div>
  );
}

const SKELETON_SECTIONS = [5, 3, 3, 4];
const SKELETON_LABELS = ['34%', '22%', '40%', '28%', '31%'];
const SKELETON_VALUES = ['26%', '38%', '20%', '33%', '24%'];

export function EventSkeleton() {
  return (
    <div className={s.detail}>
      <span className={s.srOnly} role="status">Loading activity event</span>
      {SKELETON_SECTIONS.map((count, section) => (
        <div key={section} className={s.section} aria-hidden>
          <Skeleton width={84} height={10} />
          <div className={s.skeletonRows}>
            {Array.from({ length: count }, (_, row) => (
              <div key={row} className={s.skeletonRow}>
                <Skeleton width={SKELETON_LABELS[(section + row) % SKELETON_LABELS.length]} height={12} />
                <Skeleton width={SKELETON_VALUES[(section + row) % SKELETON_VALUES.length]} height={12} />
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
