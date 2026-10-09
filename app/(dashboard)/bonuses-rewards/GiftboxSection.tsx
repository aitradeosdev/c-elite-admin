'use client';

import { useId, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Gift, Pencil, Plus } from 'lucide-react';
import {
  Badge, Button, Card, CardBody, ErrorState, MobileDataList, Money, ResponsiveView, StatusDot, TBody, THead, Table,
  TableEmpty, TableSkeleton, TableState, Td, Th, Tr, useConfirm, useToast,
  type MobileDataListRow, type TableSkeletonColumn,
} from '../../_ui';
import { apiRequest, type ApiFailure } from '../../lib/apiClient';
import { formatCount, plural } from './rewardRules';
import {
  GIFTBOX_ENDPOINT, classifyGiftboxSave, formatDay, giftboxStatus, giftboxToggleBody, rulesSummary, toGiftboxReceipt,
  type GiftboxItem, type GiftboxOutcome, type RulesSummary,
} from './model';
import { giftboxToggleOptions } from './confirmOptions';
import { SectionHeading } from './RewardParts';
import { GiftboxEditor } from './GiftboxEditor';
import s from './page.module.css';

const SKELETON_COLUMNS: readonly TableSkeletonColumn[] = [
  { width: 180, lines: 2 },
  { width: 72, align: 'right' },
  { width: 150 },
  { width: 84 },
  { width: 40, align: 'right' },
  { width: 72 },
];

const SKELETON_WITH_ACTIONS: readonly TableSkeletonColumn[] = [
  ...SKELETON_COLUMNS,
  { width: 140, align: 'right', button: true },
];

interface EditorTarget {
  item: GiftboxItem | null;
  key: number;
}

export interface GiftboxSectionProps {
  items: GiftboxItem[] | undefined;
  error: ApiFailure | null;
  loading: boolean;
  refreshing: boolean;
  canWrite: boolean;
  today: string;
  reload: () => Promise<GiftboxItem[] | null>;
}

function RulesCell({ summary }: { summary: RulesSummary }) {
  return (
    <span className={s.rulesCell}>
      <span className={s.rulesText}>{summary.text}</span>
      {summary.more > 0 ? <span className={s.rulesMore}>+{formatCount(summary.more)} more</span> : null}
      {summary.impact === 'blocking' ? <Badge tone="danger">Blocks claims</Badge> : null}
      {summary.impact === 'warning' ? <Badge tone="warning">Check rules</Badge> : null}
    </span>
  );
}

export function GiftboxSection({ items, error, loading, refreshing, canWrite, today, reload }: GiftboxSectionProps) {
  const toast = useToast();
  const confirm = useConfirm();
  const router = useRouter();
  const headingId = useId();
  const [editor, setEditor] = useState<EditorTarget | null>(null);
  const [acting, setActing] = useState<string | null>(null);
  const busyRef = useRef(false);
  const seqRef = useRef(0);

  const rows = items ?? [];
  const columns = canWrite ? 7 : 6;
  const blocked = rows.length === 0 && error !== null;

  const openEditor = (item: GiftboxItem | null) => {
    if (busyRef.current) return;
    seqRef.current += 1;
    setEditor({ item, key: seqRef.current });
  };

  const toggle = async (item: GiftboxItem) => {
    if (busyRef.current) return;
    busyRef.current = true;
    setActing(item.id);
    const next = !item.active;
    try {
      const decision = await confirm<GiftboxOutcome>({
        ...giftboxToggleOptions(item, next, today),
        action: async () => {
          const outcome = classifyGiftboxSave(await apiRequest(GIFTBOX_ENDPOINT, {
            method: 'PATCH',
            body: giftboxToggleBody(item, next),
            select: toGiftboxReceipt,
          }));
          if (outcome.kind === 'retry') throw new Error(outcome.message);
          if (outcome.kind !== 'expired' && outcome.kind !== 'refused') await reload();
          return outcome;
        },
      });
      const outcome = decision?.value;
      if (!outcome) return;
      switch (outcome.kind) {
        case 'saved':
          toast.show(
            outcome.receipt.changed
              ? next ? `“${item.title}” is switched on.` : `“${item.title}” is switched off.`
              : `“${item.title}” was already switched ${next ? 'on' : 'off'}.`,
            outcome.receipt.changed ? 'success' : 'default',
          );
          if (outcome.receipt.warning) toast.show(outcome.receipt.warning, 'warning');
          return;
        case 'conflict':
          toast.show('Another admin changed this gift box first, so nothing was changed. The list now shows its current state.', 'warning');
          return;
        case 'missing':
          toast.show('This gift box no longer exists, so nothing was changed.', 'error');
          return;
        case 'unknown':
          toast.show(`${outcome.message} The list was reloaded: check the gift box before trying again.`, 'error');
          return;
        case 'refused':
          toast.show(outcome.message, 'error');
          if (outcome.status === 403) router.refresh();
          return;
        default:
          return;
      }
    } finally {
      busyRef.current = false;
      setActing(null);
    }
  };

  const actions = (item: GiftboxItem) => {
    const busy = acting !== null;
    return (
      <>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          leftIcon={<Pencil size={14} aria-hidden />}
          aria-label={`Edit ${item.title}`}
          aria-disabled={busy || undefined}
          onClick={() => openEditor(item)}
        >
          Edit
        </Button>
        <Button
          type="button"
          variant={item.active ? 'dangerSubtle' : 'secondary'}
          size="sm"
          aria-label={`${item.active ? 'Switch off' : 'Switch on'} ${item.title}`}
          aria-disabled={busy || undefined}
          aria-busy={acting === item.id || undefined}
          onClick={() => void toggle(item)}
        >
          {item.active ? 'Switch off' : 'Switch on'}
        </Button>
      </>
    );
  };

  const createButton = canWrite ? (
    <Button type="button" variant="primary" size="sm" leftIcon={<Plus size={14} aria-hidden />} onClick={() => openEditor(null)}>
      New gift box
    </Button>
  ) : undefined;

  const emptyHint = canWrite
    ? 'Create one to give users a reward they can claim from the Giftbox screen.'
    : 'Gift boxes created by admins with the Configure rewards permission appear here.';

  const desktop = (
    <Table aria-label="Gift boxes" flush busy={refreshing && rows.length > 0}>
      <THead>
        <Tr>
          <Th>Gift box</Th>
          <Th align="right">Reward</Th>
          <Th>Who can claim</Th>
          <Th>Ends</Th>
          <Th align="right">Claims</Th>
          <Th>Status</Th>
          {canWrite ? <Th align="right"><span className={s.srOnly}>Actions</span></Th> : null}
        </Tr>
      </THead>
      <TBody>
        {loading && rows.length === 0 ? (
          <TableSkeleton rows={3} columns={canWrite ? SKELETON_WITH_ACTIONS : SKELETON_COLUMNS} />
        ) : blocked ? (
          <TableState colSpan={columns}>
            <ErrorState
              compact
              title="The gift boxes could not be loaded"
              message={error?.message}
              requestId={error?.requestId}
              onRetry={() => void reload()}
              retrying={refreshing}
            />
          </TableState>
        ) : rows.length === 0 ? (
          <TableEmpty
            colSpan={columns}
            icon={<Gift size={20} strokeWidth={1.75} aria-hidden />}
            title="No gift boxes yet"
            hint={emptyHint}
            actions={createButton}
          />
        ) : rows.map((item) => {
          const status = giftboxStatus(item, today);
          return (
            <Tr key={item.id}>
              <Td>
                <span className={s.giftCell}>
                  <span className={s.giftTitle}>{item.title}</span>
                  {item.description ? <span className={s.giftDescription}>{item.description}</span> : null}
                </span>
              </Td>
              <Td align="right"><Money value={item.reward} emphasis="primary" /></Td>
              <Td><RulesCell summary={rulesSummary(item.rules)} /></Td>
              <Td emphasis="secondary" className={s.nowrap}>{item.expiry ? formatDay(item.expiry) : 'No end date'}</Td>
              <Td align="right" mono>{item.claims === null ? '—' : formatCount(item.claims)}</Td>
              <Td><StatusDot status={status.kind} tone={status.tone} label={status.label} /></Td>
              {canWrite ? (
                <Td align="right">
                  <span className={s.rowActions}>{actions(item)}</span>
                </Td>
              ) : null}
            </Tr>
          );
        })}
      </TBody>
    </Table>
  );

  const renderRow = (item: GiftboxItem): MobileDataListRow => {
    const status = giftboxStatus(item, today);
    const summary = rulesSummary(item.rules);
    const ends = item.expiry ? `Ends ${formatDay(item.expiry)}` : 'No end date';
    const claimed = item.claims === null ? 'Claims unknown' : plural(item.claims, 'claim', 'claims');
    return {
      primary: item.title,
      value: <Money value={item.reward} emphasis="primary" />,
      secondary: summary.more > 0 ? `${summary.text} · +${formatCount(summary.more)} more` : summary.text,
      status: <StatusDot status={status.kind} tone={status.tone} label={status.label} />,
      meta: `${ends} · ${claimed}`,
      flag: summary.impact === 'blocking' ? 'danger' : null,
      flagLabel: summary.impact === 'blocking' ? 'A rule stops every claim' : undefined,
      actions: canWrite ? actions(item) : undefined,
    };
  };

  const mobile = (
    <MobileDataList<GiftboxItem>
      items={rows}
      getKey={(item) => item.id}
      renderRow={renderRow}
      ariaLabel="gift boxes"
      loading={loading || refreshing}
      initialLoading={loading && rows.length === 0}
      busy={refreshing && rows.length > 0}
      error={blocked ? error?.message ?? null : null}
      errorTitle="The gift boxes could not be loaded"
      onRetry={() => void reload()}
      skeletonRows={3}
      empty={{ title: 'No gift boxes yet', hint: emptyHint, actions: createButton, icon: <Gift size={20} strokeWidth={1.75} aria-hidden /> }}
    />
  );

  return (
    <section aria-labelledby={headingId} className={s.section}>
      <SectionHeading
        id={headingId}
        title="Gift boxes"
        hint="One-off rewards users claim from the Giftbox screen in the app. Each user can claim each gift box once."
        actions={rows.length > 0 ? createButton : undefined}
      />
      <ResponsiveView
        desktop={<Card><CardBody flush>{desktop}</CardBody></Card>}
        mobile={mobile}
      />
      {editor ? (
        <GiftboxEditor
          key={editor.key}
          item={editor.item}
          items={rows}
          today={today}
          reload={reload}
          onClose={() => setEditor(null)}
        />
      ) : null}
    </section>
  );
}
