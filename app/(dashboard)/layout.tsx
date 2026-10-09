import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { verifyAdminJWT } from '../lib/jwt';
import { resolvePermissions } from '../lib/permissions';
import { Shell } from './_shell/Shell';
import { SIDEBAR_COLLAPSED_COOKIE, parseSidebarCollapsed } from './_shell/nav';

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const cookieStore = await cookies();
  const token = cookieStore.get('admin_token')?.value;
  if (!token) redirect('/login');

  const admin = await verifyAdminJWT(token);
  if (!admin) redirect('/login');

  const permissions = Array.from(resolvePermissions(admin.page_permissions, admin.is_super_admin)).sort();

  return (
    <Shell
      allowedKeys={admin.page_permissions}
      isSuperAdmin={admin.is_super_admin}
      permissions={permissions}
      username={admin.username}
      roleTitle={admin.role_title}
      initialCollapsed={parseSidebarCollapsed(cookieStore.get(SIDEBAR_COLLAPSED_COOKIE)?.value)}
    >
      {children}
    </Shell>
  );
}
