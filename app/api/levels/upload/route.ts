import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { verifyAdminJWT } from '../../../lib/jwt';
import { supabaseAdmin } from '../../../lib/supabase';
import { ALLOWED_IMAGE_TYPES, MAX_UPLOAD_BYTES } from '../../../lib/uploadTypes';

// POST — upload a badge image (PNG/JPG/WEBP) to the level-badges bucket; return publicUrl.
export async function POST(req: NextRequest) {
  const cookieStore = await cookies();
  const token = cookieStore.get('admin_token')?.value;
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const admin = await verifyAdminJWT(token);
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!admin.is_super_admin && !admin.page_permissions.includes('bonuses_rewards')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const formData = await req.formData();
  const file = formData.get('file') as File;
  const tierOrderRaw = formData.get('tier_order');
  if (!file) return NextResponse.json({ error: 'No file provided' }, { status: 400 });

  const tierOrder = Number(tierOrderRaw);
  if (!Number.isInteger(tierOrder) || tierOrder < 0 || tierOrder > 99) {
    return NextResponse.json({ error: 'Invalid tier_order' }, { status: 400 });
  }

  const ext = (file.name.split('.').pop() || '').toLowerCase();
  const contentType = ALLOWED_IMAGE_TYPES[ext];
  if (!contentType) {
    return NextResponse.json({ error: `File type not allowed. Accepted: ${Object.keys(ALLOWED_IMAGE_TYPES).join(', ')}` }, { status: 400 });
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    return NextResponse.json({ error: 'File too large (max 5 MB)' }, { status: 400 });
  }

  const fileName = `tier-${tierOrder}-${crypto.randomUUID()}.${ext}`;
  const buffer = Buffer.from(await file.arrayBuffer());

  const { error } = await supabaseAdmin.storage
    .from('level-badges')
    .upload(fileName, buffer, { contentType, upsert: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const { data: { publicUrl } } = supabaseAdmin.storage
    .from('level-badges')
    .getPublicUrl(fileName);

  return NextResponse.json({ url: publicUrl });
}
