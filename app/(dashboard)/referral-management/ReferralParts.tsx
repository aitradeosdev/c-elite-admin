'use client';

import type { ReactNode, RefObject } from 'react';
import { LoaderCircle } from 'lucide-react';
import {
  Button, Card, CardBody, CardHeader, FieldShell, Input, Money, Notice, RowOpen, Skeleton, StatusDot, Toggle,
} from '../../_ui';
import { BUSINESS_TZ_LABEL, formatAge, formatBusinessDate, formatBusinessDateTime, formatBusinessTime } from '../../lib/time';
import {
  SETTING_LABELS, STATUS_LABELS, STATUS_TONES, formatCount, latestUpdate, readSetting, settingIssues, settingText,
  sideState,
  type ReferralStatus, type SettingKey, type SideState, type StoredSettings,
} from './referralRules';
import {
  draftValue, entryChanged, unsavedText, userHandle,
  type Draft, type PageNotice, type Phase, type ReferralRow,
} from './model';
import s from './page.module.css';

const FIELD_KEYS: readonly SettingKey[] = [
  'referral_referrer_bonus', 'referral_referee_bonus', 'referral_min_trade_usd', 'referral_max_per_day',
];

const FIELD_LABELS: Readonly<Record<SettingKey, string>> = {
  referral_active: 'Referral programme',
  referral_referrer_bonus: 'Referrer bonus (₦)',
  referral_referee_bonus: 'Referred user bonus (₦)',
  referral_min_trade_usd: 'Minimum first trade',
  referral_max_per_day: 'Referrals per referrer, 24 hours',
};

const FIELD_HELP: Readonly<Record<SettingKey, string>> = {
  referral_active: 'Whether sign-ups that use a referral code are recorded as referrals.',
  referral_referrer_bonus: 'Paid to the user whose referral code was used. The app shows this amount.',
  referral_referee_bonus: 'Paid to the new user who signed up with the code.',
  referral_min_trade_usd: 'Card value the referred user’s first qualifying trade must reach, in the card’s own currency.',
  referral_max_per_day: 'Further sign-ups in any 24 hours are not recorded as referrals.',
};

const SIDE_TEXT: Readonly<Record<SideState, string>> = {
  none: 'No bonus',
  locked: 'Locked',
  unclaimed: 'Not claimed',
  claimed: 'Claimed',
};

const SIDE_CLASS: Readonly<Record<SideState, string>> = {
  none: s.sideMuted,
  locked: s.sideMuted,
  unclaimed: s.sideWarning,
  claimed: s.sideSuccess,
};

export function settingFieldId(base: string, key: SettingKey): string {
  return `${base}-${key}`;
}

export function DiffValue({ from, to, mono }: { from: ReactNode; to: ReactNode; mono?: boolean }) {
  return (
    <span className={s.diff}>
      <span className={s.srOnly}>From </span>
      <span className={mono ? `${s.diffFrom} ${s.mono}` : s.diffFrom}>{from}</span>
      <span className={s.diffArrow} aria-hidden>→</span>
      <span className={s.srOnly}> to </span>
      <span className={mono ? `${s.diffTo} ${s.mono}` : s.diffTo}>{to}</span>
    </span>
  );
}

export function UnsavedMark() {
  return (
    <span className={s.unsaved}>
      <span className={s.unsavedDot} aria-hidden />
      Unsaved
    </span>
  );
}

export function SectionHeading({ id, title, hint }: { id: string; title: string; hint?: ReactNode }) {
  return (
    <div className={s.sectionHead}>
      <h2 id={id} className={s.sectionTitle}>{title}</h2>
      {hint ? <p className={s.sectionHint}>{hint}</p> : null}
    </div>
  );
}

export function PageNoticeView({ notice, onDismiss }: { notice: PageNotice; onDismiss: () => void }) {
  return (
    <Notice
      tone={notice.tone}
      title={notice.title}
      announce={notice.tone === 'danger' ? true : 'polite'}
      onDismiss={onDismiss}
      dismissLabel="Dismiss this notice"
    >
      <p className={s.noticeText}>{notice.message}</p>
      {notice.items.length > 0 ? (
        <ul className={s.noticeList}>
          {notice.items.map((item) => (
            <li key={item.id}>
              <span className={s.noticeItemTitle}>{item.title}</span>: {item.detail}
            </li>
          ))}
        </ul>
      ) : null}
    </Notice>
  );
}

export function SettingIssuesNotice({ live, editable }: { live: StoredSettings; editable: boolean }) {
  const issues = settingIssues(live);
  if (issues.length === 0) return null;
  const broken = issues.filter(({ issue }) => issue.level === 'danger').length;
  const title = broken === 0
    ? 'Check the referral settings'
    : broken === 1 ? 'A referral setting cannot be read' : 'Referral settings cannot be read';
  return (
    <Notice tone={broken > 0 ? 'danger' : 'warning'} title={title} announce={broken > 0 ? true : 'polite'}>
      <ul className={s.noticeList}>
        {issues.map(({ key, issue }) => (
          <li key={key}>
            <span className={s.noticeItemTitle}>{SETTING_LABELS[key]}</span>: {issue.message}
          </li>
        ))}
      </ul>
      <p className={s.noticeFoot}>
        {editable
          ? 'Enter a valid value in the programme settings below and save to fix it.'
          : 'Only a super administrator can fix this.'}
      </p>
    </Notice>
  );
}

interface EditableFieldProps {
  settingKey: SettingKey;
  live: StoredSettings;
  draft: Draft;
  error?: string;
  id: string;
  onEdit: (key: SettingKey, value: string) => void;
  onTouch: (key: SettingKey) => void;
}

function EditableField({ settingKey, live, draft, error, id, onEdit, onTouch }: EditableFieldProps) {
  const entry = draft[settingKey];
  const changed = entryChanged(settingKey, entry);
  const help = changed && entry
    ? `Live value: ${settingText(settingKey, readSetting(settingKey, entry.base))}`
    : FIELD_HELP[settingKey];
  return (
    <FieldShell
      label={<span className={s.fieldLabel}>{FIELD_LABELS[settingKey]}{changed ? <UnsavedMark /> : null}</span>}
      htmlFor={id}
      error={error}
      help={help}
    >
      <Input
        id={id}
        mono
        inputMode={settingKey === 'referral_max_per_day' ? 'numeric' : 'decimal'}
        autoComplete="off"
        spellCheck={false}
        value={draftValue(live, draft, settingKey)}
        onChange={(event) => onEdit(settingKey, event.target.value)}
        onBlur={() => onTouch(settingKey)}
      />
    </FieldShell>
  );
}

function ReadOnlyField({ settingKey, live }: { settingKey: SettingKey; live: StoredSettings }) {
  const reading = readSetting(settingKey, live[settingKey]);
  const broken = reading.issue?.level === 'danger';
  return (
    <div className={s.readOnly}>
      <dt className={s.readOnlyLabel}>{FIELD_LABELS[settingKey]}</dt>
      <dd className={broken ? `${s.readOnlyValue} ${s.valueDanger}` : s.readOnlyValue}>{settingText(settingKey, reading)}</dd>
      <dd className={s.readOnlyHelp}>{FIELD_HELP[settingKey]}</dd>
    </div>
  );
}

export interface SettingsCardProps {
  live: StoredSettings;
  draft: Draft;
  errors: Partial<Record<SettingKey, string>>;
  editable: boolean;
  idBase: string;
  headingId: string;
  onEdit: (key: SettingKey, value: string) => void;
  onTouch: (key: SettingKey) => void;
}

export function SettingsCard({ live, draft, errors, editable, idBase, headingId, onEdit, onTouch }: SettingsCardProps) {
  const updated = latestUpdate(live);
  let control: ReactNode;
  if (editable) {
    const on = draftValue(live, draft, 'referral_active') === 'true';
    control = (
      <Toggle
        checked={on}
        label={on ? 'On' : 'Off'}
        aria-label="Referral programme"
        onChange={(next) => onEdit('referral_active', next ? 'true' : 'false')}
      />
    );
  } else {
    const { effective } = readSetting('referral_active', live.referral_active);
    const label = effective === null ? 'Unreadable' : effective ? 'On' : 'Off';
    control = (
      <StatusDot status={label} tone={effective === null ? 'danger' : effective ? 'success' : 'neutral'} label={label} />
    );
  }
  return (
    <Card className={s.settingsCard}>
      <CardHeader
        title={(
          <h3 id={headingId} className={s.cardTitle}>
            Programme settings
            {entryChanged('referral_active', draft.referral_active) ? <UnsavedMark /> : null}
          </h3>
        )}
        subtitle={updated ? `Last changed ${formatBusinessDateTime(updated)} ${BUSINESS_TZ_LABEL}` : 'Changes apply as soon as they are saved.'}
        actions={control}
      />
      <CardBody className={s.settingsBody}>
        {editable ? (
          <div className={s.fieldGrid}>
            {FIELD_KEYS.map((key) => (
              <EditableField
                key={key}
                settingKey={key}
                live={live}
                draft={draft}
                error={errors[key]}
                id={settingFieldId(idBase, key)}
                onEdit={onEdit}
                onTouch={onTouch}
              />
            ))}
          </div>
        ) : (
          <>
            <Notice tone="neutral" compact flush>
              Only super administrators can change the referral programme. The values are shown so you can see how it is
              set up.
            </Notice>
            <dl className={`${s.fieldGrid} ${s.readOnlyList}`}>
              {FIELD_KEYS.map((key) => <ReadOnlyField key={key} settingKey={key} live={live} />)}
            </dl>
          </>
        )}
      </CardBody>
    </Card>
  );
}

export function HowItWorks({ live }: { live: StoredSettings }) {
  const active = readSetting('referral_active', live.referral_active).effective;
  const limit = readSetting('referral_max_per_day', live.referral_max_per_day);
  const minimum = readSetting('referral_min_trade_usd', live.referral_min_trade_usd);
  const limitText = typeof limit.effective === 'number' && limit.effective >= 1
    ? `One referrer can earn from at most ${settingText('referral_max_per_day', limit)} in any 24 hours; later sign-ups in that window still create an account but no referral.`
    : 'The 24-hour limit has no usable value, so no referral is recorded until it is fixed.';
  const recorded = active === null
    ? 'The programme switch cannot be read, so sign-ups that use a referral code fail until it is fixed.'
    : active
      ? `When someone signs up with a user’s referral code, a referral is recorded with the bonus amounts in force at that moment. ${limitText}`
      : 'The programme is off, so sign-ups that use a referral code create an account but no referral. Referrals recorded earlier are not affected.';
  const unlocked = typeof minimum.effective === 'number'
    ? `Both bonuses unlock once the referred user has a card trade approved with a card value of at least ${settingText('referral_min_trade_usd', minimum)} in the card’s own currency. Changing this minimum does not re-check trades that were already approved.`
    : 'Both bonuses unlock once the referred user has a qualifying card trade approved. The minimum card value cannot be read right now; see the notice above.';
  return (
    <Card className={s.howCard}>
      <CardHeader
        title={<h3 className={s.cardTitle}>How referrals work</h3>}
        subtitle="What the platform does with these settings. Information only."
      />
      <CardBody>
        <ol className={s.steps}>
          <li className={s.step}>
            <span className={s.stepTitle}>Recorded at sign-up</span>
            <span className={s.stepText}>{recorded}</span>
          </li>
          <li className={s.step}>
            <span className={s.stepTitle}>Unlocked by a qualifying trade</span>
            <span className={s.stepText}>{unlocked}</span>
          </li>
          <li className={s.step}>
            <span className={s.stepTitle}>Claimed in the app</span>
            <span className={s.stepText}>
              Each user claims their own bonus in the app, and it is credited to their bonus balance. Referral bonuses are
              not paid out from this console.
            </span>
          </li>
        </ol>
      </CardBody>
    </Card>
  );
}

export function ProgrammeSkeleton() {
  return (
    <div className={s.programmeGrid} aria-busy="true">
      <span className={s.srOnly} role="status">Loading the referral programme</span>
      <Card className={s.settingsCard} aria-hidden>
        <div className={s.skeletonCard}>
          <Skeleton width="45%" height={14} />
          <div className={s.fieldGrid}>
            {[0, 1, 2, 3].map((index) => (
              <div key={index} className={s.skeletonField}>
                <Skeleton width="60%" height={12} />
                <Skeleton width="100%" height={34} />
              </div>
            ))}
          </div>
        </div>
      </Card>
      <Card className={s.howCard} aria-hidden>
        <div className={s.skeletonCard}>
          <Skeleton width="50%" height={14} />
          <Skeleton width="92%" height={12} />
          <Skeleton width="84%" height={12} />
          <Skeleton width="88%" height={12} />
        </div>
      </Card>
    </div>
  );
}

export function UserCell({ id, name, fullName, canOpen }: {
  id: string | null;
  name: string | null;
  fullName: string | null;
  canOpen: boolean;
}) {
  const handle = userHandle(name, fullName);
  const secondary = name ? fullName : null;
  return (
    <div className={s.stack}>
      {canOpen && id ? (
        <RowOpen href={`/users/${encodeURIComponent(id)}`} prefetch={false}>{handle}</RowOpen>
      ) : (
        <span className={s.lead}>{handle}</span>
      )}
      {secondary ? <span className={s.sub}>{secondary}</span> : null}
    </div>
  );
}

export function DateCell({ value, empty }: { value: string | null; empty: string }) {
  if (!value) return <span className={s.muted}>{empty}</span>;
  return (
    <div className={s.stack}>
      <span className={s.time}>{formatBusinessDate(value)}</span>
      <span className={s.sub}>{formatBusinessTime(value)} {BUSINESS_TZ_LABEL} · {formatAge(value)} ago</span>
    </div>
  );
}

function BonusLine({ who, amount, state }: { who: string; amount: number | null; state: SideState }) {
  return (
    <span className={s.bonusLine}>
      <span className={s.bonusWho}>{who}</span>
      <Money value={amount} size="sm" />
      <span className={SIDE_CLASS[state]}>{SIDE_TEXT[state]}</span>
    </span>
  );
}

export function BonusCell({ row }: { row: ReferralRow }) {
  return (
    <div className={s.bonusCell}>
      <BonusLine
        who="Referrer"
        amount={row.referrerBonus}
        state={sideState(row.firstTradeCompleted, row.referrerBonus, row.referrerCredited)}
      />
      <BonusLine
        who="Referred user"
        amount={row.refereeBonus}
        state={sideState(row.firstTradeCompleted, row.refereeBonus, row.refereeCredited)}
      />
    </div>
  );
}

export function ReferralStatusDot({ status }: { status: ReferralStatus }) {
  return <StatusDot status={status} tone={STATUS_TONES[status]} label={STATUS_LABELS[status]} />;
}

export interface UnsavedBarProps {
  count: number;
  issues: number;
  phase: Phase;
  reviewRef?: RefObject<HTMLButtonElement | null>;
  onDiscard: () => void;
  onReview: () => void;
}

export function UnsavedBar({ count, issues, phase, reviewRef, onDiscard, onReview }: UnsavedBarProps) {
  const busy = phase !== 'idle';
  const working = phase === 'checking' || phase === 'saving';
  const status = phase === 'checking'
    ? 'Checking the live values…'
    : phase === 'saving'
      ? 'Saving…'
      : unsavedText(count);
  const action = phase === 'checking' ? 'Checking…' : phase === 'saving' ? 'Saving…' : 'Review changes';
  return (
    <div className={s.bar} role="region" aria-label="Unsaved referral settings">
      <p className={s.barStatus} role="status">
        <span className={s.barDot} aria-hidden />
        <span>{status}</span>
        {issues > 0 && !working ? <span className={s.barIssues}>{formatCount(issues)} to fix</span> : null}
      </p>
      <div className={s.barActions}>
        <Button type="button" variant="ghost" aria-disabled={busy || undefined} onClick={onDiscard}>
          Discard
        </Button>
        <Button
          ref={reviewRef}
          type="button"
          variant="primary"
          aria-disabled={busy || undefined}
          aria-busy={working || undefined}
          leftIcon={working ? <LoaderCircle size={14} aria-hidden className={s.spin} /> : undefined}
          onClick={onReview}
        >
          {action}
        </Button>
      </div>
    </div>
  );
}
