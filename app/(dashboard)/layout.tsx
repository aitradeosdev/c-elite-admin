import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { verifyAdminJWT } from '../lib/jwt';
import { Shell } from './_shell/Shell';

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const cookieStore = await cookies();
  const token = cookieStore.get('admin_token')?.value;
  if (!token) redirect('/login');

  const admin = await verifyAdminJWT(token);
  if (!admin) redirect('/login');

  // IMPORTANT: only pass serialisable values across the server/client boundary.
  // Nav icons are function components (not serialisable) so the Shell client
  // must do its own filtering against the in-module nav config — server just
  // hands it the permission keys.
  return (
    <Shell
      allowedKeys={admin.page_permissions}
      isSuperAdmin={admin.is_super_admin}
      username={admin.username}
      roleTitle={admin.role_title}
    >
      {children}
    </Shell>
  );
}
