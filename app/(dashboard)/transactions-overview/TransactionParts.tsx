'use client';

import Link from 'next/link';
import { ArrowUpRight } from 'lucide-react';
import { DetailRow, JsonViewer, MaskedValue, Money, Ref, SectionLabel, Skeleton, StatusDot } from '../../_ui';
import { METADATA_MASK_KEYS, maskMetadata } from '../../lib/mask';
import { formatAge, formatBusinessDateTime } from '../../lib/time';
import {
  metadataRows, relatedLink, typeLabel,
  type Capabilities, type MetaRow, type Transaction,
} from './model';
import s from './page.module.css';

function MetaValue({ row }: { row: MetaRow }) {
  switch (row.kind) {
    case 'masked':
      return <MaskedValue value={row.text} srLabel={row.label} />;
    case 'money':
      return <Money value={row.text} />;
    case 'datetime':
      return <>{formatBusinessDateTime(row.text)} WAT</>;
    case 'id':
      return <Ref value={row.text} label={row.label.toLowerCase()} truncate={13} />;
    case 'json':
      return <code className={s.inlineCode}>{row.text}</code>;
    case 'empty':
      return <span className={s.muted}>—</span>;
    default:
      return <>{row.text}</>;
  }
}

function TypeValue({ type }: { type: string | null }) {
  return (
    <span className={s.typeValue}>
      <span>{typeLabel(type)}</span>
      {type ? <code className={s.typeCode}>{type}</code> : null}
    </span>
  );
}

export function DetailBody({ transaction, can }: { transaction: Transaction; can: Capabilities }) {
  const user = transaction.users ?? null;
  const related = relatedLink(transaction, can);
  const metadata = transaction.metadata;
  const meta = metadataRows(metadata);
  const hasRaw = metadata !== null && typeof metadata === 'object'
    && (Array.isArray(metadata) || Object.keys(metadata).length > 0);

  return (
    <div className={s.detail}>
      <div className={s.hero}>
        <Money value={transaction.amount} emphasis="strong" size="2xl" />
        <div className={s.heroMeta}>
          <StatusDot status={transaction.status || 'unknown'} />
          <span>{typeLabel(transaction.type)}</span>
        </div>
      </div>

      <div className={s.section}>
        <SectionLabel>Transaction</SectionLabel>
        <DetailRow label="Type" value={<TypeValue type={transaction.type} />} wrap />
        <DetailRow
          label="Created"
          value={`${formatBusinessDateTime(transaction.created_at)} WAT · ${formatAge(transaction.created_at)} ago`}
          wrap
        />
        <DetailRow
          label="Transaction ID"
          value={<Ref value={transaction.id} label="transaction ID" truncate={13} />}
        />
        <DetailRow
          label="Reference"
          value={<Ref value={transaction.reference_id} label="reference" truncate={13} />}
        />
        {related ? (
          <DetailRow
            label="Source"
            value={
              <Link href={related.href} className={s.inlineLink}>
                {related.label} <ArrowUpRight size={12} aria-hidden />
              </Link>
            }
          />
        ) : null}
      </div>

      <div className={s.section}>
        <div className={s.sectionHead}>
          <SectionLabel flush>User</SectionLabel>
          {can.users && transaction.user_id ? (
            <Link href={`/users/${transaction.user_id}`} className={s.headLink}>
              View user <ArrowUpRight size={12} aria-hidden />
            </Link>
          ) : null}
        </div>
        <DetailRow label="Name" value={user?.full_name || '—'} wrap />
        <DetailRow label="Username" value={user?.username ? `@${user.username}` : '—'} wrap />
        <DetailRow label="Email" value={user?.email || '—'} wrap />
        <DetailRow label="User ID" value={<Ref value={transaction.user_id} label="user ID" truncate={13} />} />
      </div>

      <div className={s.section}>
        <SectionLabel>Metadata</SectionLabel>
        {meta.length ? (
          meta.map((row) => <DetailRow key={row.key} label={row.label} value={<MetaValue row={row} />} wrap />)
        ) : (
          <p className={s.none}>No metadata was recorded for this transaction.</p>
        )}
        {hasRaw ? (
          <JsonViewer
            key={transaction.id}
            className={s.raw}
            value={maskMetadata(metadata)}
            label="Raw metadata"
            defaultExpandDepth={0}
            maskKeys={METADATA_MASK_KEYS}
            copyable
          />
        ) : null}
      </div>
    </div>
  );
}

const SKELETON_SECTIONS = [4, 4, 3];
const SKELETON_LABELS = ['34%', '22%', '40%', '28%', '31%'];
const SKELETON_VALUES = ['26%', '38%', '20%', '33%', '24%'];

export function DetailSkeleton() {
  return (
    <div className={s.detail}>
      <span className={s.srOnly} role="status">Loading transaction</span>
      <div className={s.hero} aria-hidden>
        <Skeleton width="46%" height={28} />
        <Skeleton width="32%" height={12} />
      </div>
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
