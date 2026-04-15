import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { verifyAdminJWT } from '../../../lib/jwt';
import { supabaseAdmin } from '../../../lib/supabase';

// POST — upload a badge image (SVG/PNG/JPG) to the level-badges bucket; return publicUrl.
export async function POST(req: NextRequest) {
  const cookieStore = await cookies();
  const token = cookieStore.get('admin_token')?.value;
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const admin = await verifyAdminJWT(token);
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const formData = await req.formData();
  const file = formData.get('file') as File;
  const tierOrder = formData.get('tier_order');
  if (!file) return NextResponse.json({ error: 'No file provided' }, { status: 400 });

  const ext = (file.name.split('.').pop() || 'svg').toLowerCase();
  const safeExt = ['svg', 'png', 'jpg', 'jpeg', 'webp'].includes(ext) ? ext : 'svg';
  const contentType = safeExt === 'svg' ? 'image/svg+xml' : file.type || 'image/png';

  const fileName = `tier-${tierOrder || 'x'}-${Date.now()}-${Math.random().toString(36).slice(2)}.${safeExt}`;
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
