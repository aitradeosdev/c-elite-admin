'use client';

import { useMemo, type ReactNode } from 'react';
import { usePathname } from 'next/navigation';
import { PageHeader, TabLinks, usePermissions } from '../../_ui';
import { PAGE_READ_PERMISSION } from '../../lib/permissions';
import { GENERAL_SECTION_LABEL, PLATFORM_SETTINGS, filterNavByPermissions, findNavMatch, navSections } from '../_shell/nav';
import s from './page.module.css';

export default function PlatformSettingsLayout({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const { isSuperAdmin, permissions } = usePermissions();
  const tabs = useMemo(
    () => navSections(PLATFORM_SETTINGS, filterNavByPermissions([], isSuperAdmin, permissions, PAGE_READ_PERMISSION))
      .map((leaf) => ({ href: leaf.href, label: leaf === PLATFORM_SETTINGS ? GENERAL_SECTION_LABEL : leaf.label })),
    [isSuperAdmin, permissions],
  );

  return (
    <div className={s.frame}>
      <PageHeader title={PLATFORM_SETTINGS.label} />
      <TabLinks
        variant="underline"
        aria-label="Platform Settings sections"
        items={tabs}
        current={findNavMatch(pathname)?.leaf.href ?? null}
        className={s.sections}
      />
      {children}
    </div>
  );
}
