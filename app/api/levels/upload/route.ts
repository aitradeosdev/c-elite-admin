import type { NextRequest } from 'next/server';
import { supabaseAdmin } from '../../../lib/supabase';
import { requireAdmin } from '../../../lib/guard';
import { writeAudit, type AuditInput } from '../../../lib/audit';
import { fail, ok } from '../../../lib/api';
import { ALLOWED_IMAGE_TYPES, MAX_UPLOAD_BYTES, magicMatchesExt } from '../../../lib/uploadTypes';

const BUCKET = 'level-badges';
const BADGE_MAX_PX = 320;
const BADGE_WEBP_QUALITY = 92;
const CACHE_SECONDS = '31536000';
const AUDIT_WARNING = 'The badge was uploaded, but the upload could not be written to the audit log.';

async function shrinkBadge(buffer: Buffer): Promise<{ buffer: Buffer; ext: string; contentType: string } | null> {
  try {
    const sharp = (await import('sharp')).default;
    const out = await sharp(buffer)
      .resize(BADGE_MAX_PX, BADGE_MAX_PX, { fit: 'inside', withoutEnlargement: true })
      .webp({ quality: BADGE_WEBP_QUALITY })
      .toBuffer();
    return { buffer: out, ext: 'webp', contentType: 'image/webp' };
  } catch {
    return null;
  }
}

export async function POST(req: NextRequest) {
  const guard = await requireAdmin('rewards.write');
  if (!guard.ok) return guard.response;

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return fail('VALIDATION_ERROR', 'Send the badge as a file upload.');
  }
  const file = form.get('file');
  if (!file || typeof file === 'string') return fail('VALIDATION_ERROR', 'No file provided');

  const tierOrder = Number(form.get('tier_order'));
  if (!Number.isInteger(tierOrder) || tierOrder < 0 || tierOrder > 99) {
    return fail('VALIDATION_ERROR', 'Invalid tier_order');
  }

  const ext = (file.name.split('.').pop() || '').toLowerCase();
  const contentType = ALLOWED_IMAGE_TYPES[ext];
  if (!contentType) {
    return fail('VALIDATION_ERROR', `File type not allowed. Accepted: ${Object.keys(ALLOWED_IMAGE_TYPES).join(', ')}`);
  }
  if (file.size > MAX_UPLOAD_BYTES) return fail('VALIDATION_ERROR', 'File too large (max 5 MB)');

  const original = Buffer.from(await file.arrayBuffer());
  if (!magicMatchesExt(original, ext)) {
    return fail('VALIDATION_ERROR', 'File content does not match its extension');
  }

  const shrunk = await shrinkBadge(original);
  const upload = shrunk ?? { buffer: original, ext, contentType };
  const fileName = `tier-${tierOrder}-${crypto.randomUUID()}.${upload.ext}`;

  const audit: AuditInput = {
    admin: guard.admin,
    action: 'UPLOAD_LEVEL_BADGE',
    entity: 'level_badges',
    entity_id: fileName,
    sensitivity: 'normal',
    after: { path: fileName, tier_order: tierOrder, content_type: upload.contentType, size: upload.buffer.length },
  };

  const { error } = await supabaseAdmin.storage
    .from(BUCKET)
    .upload(fileName, upload.buffer, { contentType: upload.contentType, cacheControl: CACHE_SECONDS, upsert: false });
  if (error) {
    console.error('level badge upload:', error.message);
    await writeAudit({ ...audit, result: 'failure', error: error.message });
    return fail('INTERNAL_ERROR', 'The badge could not be stored. Try again.');
  }

  const { data: { publicUrl } } = supabaseAdmin.storage.from(BUCKET).getPublicUrl(fileName);

  const recorded = await writeAudit({
    ...audit,
    after: { path: fileName, tier_order: tierOrder, content_type: upload.contentType, size: upload.buffer.length, url: publicUrl },
    result: 'success',
  });
  return ok({
    url: publicUrl,
    ...(recorded.ok ? { audit_recorded: true } : { audit_recorded: false, warning: AUDIT_WARNING }),
  });
}
