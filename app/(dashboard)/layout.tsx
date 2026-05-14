import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { verifyAdminJWT } from '../lib/jwt';
import { Shell } from './_shell/Shell';
import { filterNavByPermissions } from './_shell/nav';

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const cookieStore = await cookies();
  const token = cookieStore.get('admin_token')?.value;
  if (!token) redirect('/login');

  const admin = await verifyAdminJWT(token);
  if (!admin) redirect('/login');

  const navGroups = filterNavByPermissions(admin.page_permissions, admin.is_super_admin);

  return (
    <Shell
      navGroups={navGroups}
      username={admin.username}
      roleTitle={admin.role_title}
    >
      {children}
    </Shell>
  );
}
