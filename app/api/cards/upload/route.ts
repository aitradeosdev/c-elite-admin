import { NextRequest, NextResponse } from 'next/server';
import { verifyAdminFromRequest } from '../../../lib/jwt';
import { supabaseAdmin } from '../../../lib/supabase';
import { ALLOWED_IMAGE_TYPES, MAX_UPLOAD_BYTES, magicMatchesExt } from '../../../lib/uploadTypes';

export async function POST(req: NextRequest) {
  const admin = await verifyAdminFromRequest();
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!admin.is_super_admin && !admin.page_permissions.includes('card_management')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const formData = await req.formData();
  const file = formData.get('file') as File;
  if (!file) return NextResponse.json({ error: 'No file provided' }, { status: 400 });

  const ext = (file.name.split('.').pop() || '').toLowerCase();
  const contentType = ALLOWED_IMAGE_TYPES[ext];
  if (!contentType) {
    return NextResponse.json({ error: `File type not allowed. Accepted: ${Object.keys(ALLOWED_IMAGE_TYPES).join(', ')}` }, { status: 400 });
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    return NextResponse.json({ error: 'File too large (max 5 MB)' }, { status: 400 });
  }
  const fileName = `${crypto.randomUUID()}.${ext}`;
  const buffer = Buffer.from(await file.arrayBuffer());
  if (!magicMatchesExt(buffer, ext)) {
    return NextResponse.json({ error: 'File content does not match its extension' }, { status: 400 });
  }

  const { error } = await supabaseAdmin.storage
    .from('card-logos')
    .upload(fileName, buffer, { contentType, upsert: false });

  if (error) return NextResponse.json({ error: 'Something went wrong' }, { status: 500 });

  const { data: { publicUrl } } = supabaseAdmin.storage
    .from('card-logos')
    .getPublicUrl(fileName);

  return NextResponse.json({ url: publicUrl });
}
