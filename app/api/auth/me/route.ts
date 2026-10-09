import { supabaseAdmin } from '../../../lib/supabase';
import { requireAdmin } from '../../../lib/guard';
import { fail, ok } from '../../../lib/api';

interface ProfileRow {
  id: string;
  username: string;
  email: string;
  role_title: string;
  is_super_admin: boolean;
  is_active: boolean;
  page_permissions: string[] | null;
}

export async function GET() {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;

  const { data: row, error } = await supabaseAdmin
    .from('admin_users')
    .select('id, username, email, role_title, is_super_admin, is_active, page_permissions')
    .eq('id', guard.admin.admin_id)
    .maybeSingle<ProfileRow>();
  if (error) console.error('admin profile read failed:', error.message);
  if (!row || !row.is_active) return fail('AUTH_REQUIRED');

  return ok({
    admin: {
      id: row.id,
      username: row.username,
      email: row.email,
      role_title: row.role_title,
      is_super_admin: row.is_super_admin,
      page_permissions: row.page_permissions || [],
    },
  });
}
