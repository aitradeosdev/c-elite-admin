'use client';

import { DetailRow, Money, Notice, SectionLabel, SidePanel } from '../../_ui';
import { formatBusinessDateTime } from '../../lib/time';
import {
  awaitingText, couponStatus, expiryView, limitText, minTradeText, restrictText, usesText,
  type Brand, type CouponRow,
} from './model';
import { StatusCell, usedText } from './CouponParts';
import s from './page.module.css';

export interface CouponDetailsProps {
  coupon: CouponRow;
  today: string;
  brands: readonly Brand[] | null;
  onClose: () => void;
  returnFocusTo?: () => HTMLElement | null;
}

export function CouponDetails({ coupon, today, brands, onClose, returnFocusTo }: CouponDetailsProps) {
  const status = couponStatus(coupon, today, brands);
  const expiry = expiryView(coupon.expiry, today);
  return (
    <SidePanel
      open
      wide
      onClose={onClose}
      title={coupon.code || 'Coupon'}
      subtitle={`${coupon.type || 'No brand'} · ${status.label} · ${usedText(coupon.uses)}`}
      returnFocusTo={returnFocusTo}
    >
      <div className={s.details}>
        <Notice tone={status.state === 'live' ? 'success' : status.state === 'disabled' ? 'neutral' : 'warning'} compact flush>
          {status.hint}
        </Notice>

        <section className={s.detailSection}>
          <SectionLabel as="h3">Reward</SectionLabel>
          <DetailRow label="Status" value={<StatusCell status={status} />} />
          <DetailRow label="Bonus per trade" value={<Money value={coupon.bonus} emphasis="primary" />} />
          <DetailRow label="Brand" value={coupon.type || 'None'} />
          <DetailRow label="Minimum card value" value={minTradeText(coupon.minTrade)} />
          <DetailRow label="Who can use it" value={restrictText(coupon.restrictTo)} wrap />
        </section>

        <section className={s.detailSection}>
          <SectionLabel as="h3">Limits</SectionLabel>
          <DetailRow label="Used" value={usesText(coupon)} mono />
          <DetailRow label="Usage limit" value={limitText(coupon.limit)} />
          <DetailRow label="Expires" value={`${expiry.date} · ${expiry.relative}`} wrap />
          <DetailRow label="Awaiting review" value={awaitingText(coupon.awaitingTrades, coupon.awaitingBonus)} />
          <DetailRow
            label="Created"
            value={coupon.createdAt ? `${formatBusinessDateTime(coupon.createdAt)} WAT` : 'Unknown'}
          />
        </section>

        <section className={s.detailSection}>
          <SectionLabel as="h3">Terms of use</SectionLabel>
          <p className={coupon.terms ? s.termsText : s.termsEmpty}>{coupon.terms ?? 'No terms of use are shown with this coupon.'}</p>
        </section>

        <Notice tone="neutral" compact flush>
          You can view coupons but not change them. Changing coupons needs the Manage coupons permission (coupons.write).
        </Notice>
      </div>
    </SidePanel>
  );
}
