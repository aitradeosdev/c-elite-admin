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
