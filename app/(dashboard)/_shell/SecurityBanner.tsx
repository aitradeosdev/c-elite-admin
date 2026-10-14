'use client';

import { Notice } from '../../_ui/Notice';
import { LinkButton } from '../../_ui/LinkButton';
import {
  BANNER_ACTION_LABEL, TWO_STEP_HREF, securityBannerView, type ShellSecurity,
} from '../profile/securityModel';

export interface SecurityBannerProps {
  security: ShellSecurity | null | undefined;
  now?: Date;
}

export function SecurityBanner({ security, now }: SecurityBannerProps) {
  const view = securityBannerView(security, now);
  if (!view) return null;
  return (
    <Notice
      tone={view.tone}
      title={view.title}
      actions={<LinkButton href={TWO_STEP_HREF} size="sm">{BANNER_ACTION_LABEL}</LinkButton>}
    >
      {view.text}
    </Notice>
  );
}
