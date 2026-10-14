import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { verifyAdminSession } from '../lib/jwt';
import { SESSION_COOKIE, SessionUnavailableError } from '../lib/session';
import { resolvePermissions } from '../lib/permissions';
import { Shell } from './_shell/Shell';
import { SIDEBAR_COLLAPSED_COOKIE, parseSidebarCollapsed } from './_shell/nav';
import { shellSecurity } from './profile/securityModel';

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  if (!token) redirect('/login');

  const check = await verifyAdminSession(token, 'cookie');
  if (check.status === 'unavailable') throw new SessionUnavailableError();
  if (check.status === 'invalid') redirect('/login');
  const admin = check.claims;

  const permissions = Array.from(resolvePermissions(admin.page_permissions, admin.is_super_admin)).sort();

  return (
    <Shell
      allowedKeys={admin.page_permissions}
      isSuperAdmin={admin.is_super_admin}
      permissions={permissions}
      username={admin.username}
      roleTitle={admin.role_title}
      initialCollapsed={parseSidebarCollapsed(cookieStore.get(SIDEBAR_COLLAPSED_COOKIE)?.value)}
      security={shellSecurity(check.mfa, check.policy)}
    >
      {children}
    </Shell>
  );
}
