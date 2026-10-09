'use client';

import { useRef } from 'react';
import { ImageUp, LoaderCircle, Trash2, Undo2 } from 'lucide-react';
import {
  Avatar, Button, Card, CardBody, CardFooter, CardHeader, FieldShell, Input, Skeleton, StatusDot, Toggle,
} from '../../../_ui';
import { LEVEL_NAME_MAX, formatCount } from '../rewardRules';
import { UnsavedMark } from '../RewardParts';
import {
  BADGE_ACCEPT, BADGE_MAX_MB, conflictText, errorKey, fieldInputId, fieldValueText, viewChanges,
  type Tier, type TierField, type TierView,
} from './model';
import s from './page.module.css';

type TextField = 'name' | 'target' | 'bonus';

export interface TierCardProps {
  tier: Tier;
  view: TierView;
  errors: Readonly<Record<string, string>>;
  canWrite: boolean;
  disabled: boolean;
  uploading: boolean;
  uploadBlocked: boolean;
  uploadError: string | null;
  onText: (field: TextField, value: string) => void;
  onActive: (next: boolean) => void;
  onBadgeFile: (file: File) => void;
  onBadgeRemove: () => void;
  onRevert: () => void;
  onBlur: (field: TierField) => void;
}

function TierChanges({ view }: { view: TierView }) {
  const changes = viewChanges(view);
  const conflict = conflictText(view);
  if (changes.length === 0 && !conflict && !view.failure) return null;
  return (
    <div className={s.changes}>
      {changes.map((change) => (
        <p key={change.field} className={s.changeLine}>
          <span className={s.changeLabel}>{change.label}</span>
          <span className={s.changeFrom}>{change.from}</span>
          <span className={s.changeArrow} aria-hidden>→</span>
          <span className={s.srOnly}> changes to </span>
          {change.to === null
            ? <span className={s.changeFail}>not a valid amount</span>
            : <span className={s.changeTo}>{change.to}</span>}
          {change.large ? <span className={s.changeWarn}>Large change: check for a typo.</span> : null}
        </p>
      ))}
      {conflict ? <p className={s.changeWarn}>{conflict} Your values are kept.</p> : null}
      {view.failure ? <p className={s.changeFail}>Not saved: {view.failure}</p> : null}
    </div>
  );
}

export function TierCard({
  tier, view, errors, canWrite, disabled, uploading, uploadBlocked, uploadError,
  onText, onActive, onBadgeFile, onBadgeRemove, onRevert, onBlur,
}: TierCardProps) {
  const fileRef = useRef<HTMLInputElement>(null);
  const changed = view.changed.length > 0;
  const headingId = `tier-${tier.id}-heading`;
  const helpId = `tier-${tier.id}-badge-help`;
  const displayName = tier.values.name || `Tier ${tier.order}`;
  const error = (field: TierField) => errors[errorKey(tier.id, field)];
  const badgeBusy = disabled || uploading || uploadBlocked;
  const classes = [s.tierCard, changed && s.tierChanged, view.failure && s.tierFailed].filter(Boolean).join(' ');

  const pickFile = () => {
    if (badgeBusy) return;
    fileRef.current?.click();
  };

  return (
    <Card className={classes} role="group" aria-labelledby={headingId}>
      <CardHeader
        title={(
          <h2 id={headingId} className={s.tierHeading}>
            <span className={s.tierOrder}>Tier {tier.order}</span>
            <span className={s.tierName}>{tier.values.name || 'Unnamed tier'}</span>
          </h2>
        )}
        actions={(
          <span className={s.tierState}>
            {changed ? <UnsavedMark /> : null}
            <StatusDot status={view.active ? 'active' : 'off'} tone={view.active ? 'success' : 'neutral'} label={view.active ? 'Active' : 'Off'} />
          </span>
        )}
      />
      <CardBody className={s.tierBody}>
        <div className={s.badgeRow}>
          <Avatar src={view.badge} name={displayName} size="lg" decorative className={s.badgeTile} />
          <div className={s.badgeInfo}>
            {canWrite ? (
              <>
                <div className={s.badgeActions}>
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    leftIcon={uploading
                      ? <LoaderCircle size={14} aria-hidden className={s.spin} />
                      : <ImageUp size={14} aria-hidden />}
                    aria-disabled={badgeBusy || undefined}
                    aria-busy={uploading || undefined}
                    aria-describedby={helpId}
                    aria-label={`${uploading ? 'Uploading badge for' : view.badge ? 'Replace badge for' : 'Upload badge for'} Tier ${tier.order}`}
                    onClick={pickFile}
                  >
                    {uploading ? 'Uploading…' : view.badge ? 'Replace badge' : 'Upload badge'}
                  </Button>
                  {view.badge ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      leftIcon={<Trash2 size={14} aria-hidden />}
                      aria-disabled={badgeBusy || undefined}
                      aria-label={`Remove badge from Tier ${tier.order}`}
                      onClick={() => {
                        if (!badgeBusy) onBadgeRemove();
                      }}
                    >
                      Remove
                    </Button>
                  ) : null}
                </div>
                <input
                  ref={fileRef}
                  className={s.fileInput}
                  type="file"
                  accept={BADGE_ACCEPT}
                  tabIndex={-1}
                  aria-hidden
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    event.target.value = '';
                    if (file) onBadgeFile(file);
                  }}
                />
                <p id={helpId} className={uploadError ? s.badgeError : s.badgeHelp}>
                  {uploadError ?? `PNG, JPG or WebP, up to ${BADGE_MAX_MB} MB. Users see it after you save the tier.`}
                </p>
              </>
            ) : (
              <p className={s.badgeHelp}>{view.badge ? 'Shown on this tier in the app.' : 'No badge yet.'}</p>
            )}
          </div>
        </div>

        {canWrite ? (
          <div className={s.tierFields}>
            <FieldShell label="Name" htmlFor={fieldInputId(tier.id, 'name')} error={error('name')}>
              <Input
                id={fieldInputId(tier.id, 'name')}
                value={view.name}
                maxLength={LEVEL_NAME_MAX}
                autoComplete="off"
                disabled={disabled}
                onChange={(event) => onText('name', event.target.value)}
                onBlur={() => onBlur('name')}
              />
            </FieldShell>
            <div className={s.tierPair}>
              <FieldShell
                label="Trade target ($)"
                htmlFor={fieldInputId(tier.id, 'target')}
                error={error('target')}
                help="Approved card value traded after reaching this tier."
              >
                <Input
                  id={fieldInputId(tier.id, 'target')}
                  mono
                  inputMode="decimal"
                  autoComplete="off"
                  value={view.target}
                  disabled={disabled}
                  onChange={(event) => onText('target', event.target.value)}
                  onBlur={() => onBlur('target')}
                />
              </FieldShell>
              <FieldShell
                label="Bonus (₦)"
                htmlFor={fieldInputId(tier.id, 'bonus')}
                error={error('bonus')}
                help="Credited to the user’s bonus balance on claim."
              >
                <Input
                  id={fieldInputId(tier.id, 'bonus')}
                  mono
                  inputMode="decimal"
                  autoComplete="off"
                  value={view.bonus}
                  disabled={disabled}
                  onChange={(event) => onText('bonus', event.target.value)}
                  onBlur={() => onBlur('bonus')}
                />
              </FieldShell>
            </div>
            <Toggle
              id={fieldInputId(tier.id, 'active')}
              checked={view.active}
              disabled={disabled}
              label="Tier active"
              onChange={onActive}
            />
          </div>
        ) : (
          <dl className={s.readList}>
            <div className={s.readItem}>
              <dt>Trade target</dt>
              <dd className={s.mono}>{fieldValueText('target', tier.values.target_usd)}</dd>
            </div>
            <div className={s.readItem}>
              <dt>Bonus</dt>
              <dd className={s.mono}>{fieldValueText('bonus', tier.values.bonus_naira)}</dd>
            </div>
          </dl>
        )}

        <TierChanges view={view} />
      </CardBody>
      <CardFooter className={s.tierFoot}>
        <span className={s.claims}>
          {tier.claims === null ? 'Claims unavailable' : `${formatCount(tier.claims)} ${tier.claims === 1 ? 'claim' : 'claims'}`}
        </span>
        {canWrite && changed ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            leftIcon={<Undo2 size={14} aria-hidden />}
            aria-disabled={disabled || undefined}
            aria-label={`Undo changes to Tier ${tier.order}`}
            onClick={() => {
              if (!disabled) onRevert();
            }}
          >
            Undo
          </Button>
        ) : null}
      </CardFooter>
    </Card>
  );
}

export function TierSkeleton() {
  return (
    <Card className={s.tierCard} aria-hidden>
      <div className={s.skeletonCard}>
        <Skeleton width="45%" height={14} />
        <div className={s.badgeRow}>
          <Skeleton width={40} height={40} />
          <Skeleton width="50%" height={28} />
        </div>
        <Skeleton width="100%" height={34} />
        <Skeleton width="100%" height={34} />
      </div>
    </Card>
  );
}
