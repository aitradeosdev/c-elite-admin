import type { ReactNode } from 'react';
import s from './ResponsiveView.module.css';

export type ResponsiveBreakpoint = 'mobile' | 'desktop';

export interface ResponsiveViewProps {
  desktop: ReactNode;
  mobile: ReactNode;
  breakpoint?: ResponsiveBreakpoint;
}

export function ResponsiveView({ desktop, mobile, breakpoint = 'mobile' }: ResponsiveViewProps) {
  const at = breakpoint === 'desktop' ? s.atDesktop : s.atMobile;
  return (
    <>
      <div className={[s.view, s.desktop, at].join(' ')}>{desktop}</div>
      <div className={[s.view, s.mobile, at].join(' ')}>{mobile}</div>
    </>
  );
}
