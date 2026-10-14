import type { AnchorHTMLAttributes, ReactNode } from 'react';
import Link from 'next/link';
import { PROFILE_HREF, PROFILE_LABEL } from '../_shell/nav';
import s from './ProfileLink.module.css';

export { PROFILE_HREF, PROFILE_LABEL };

export function profileLinkLabel(username: string, roleTitle: string): string {
  const who = [username.trim(), roleTitle.trim()].filter(Boolean).join(', ');
  return who ? `${PROFILE_LABEL}: ${who}` : PROFILE_LABEL;
}

export interface ProfileLinkProps extends Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'href' | 'children'> {
  current: boolean;
  children: ReactNode;
}

export function ProfileLink({ current, className, children, ...rest }: ProfileLinkProps) {
  return (
    <Link
      {...rest}
      href={PROFILE_HREF}
      className={[s.link, current && s.current, className].filter(Boolean).join(' ')}
      aria-current={current ? 'page' : undefined}
    >
      {children}
    </Link>
  );
}
