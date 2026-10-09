import type { NextRequest } from 'next/server';
import { supabaseAdmin } from '../../../lib/supabase';
import { requireAdmin } from '../../../lib/guard';
import { writeAudit, type AuditInput } from '../../../lib/audit';
import { fail, ok } from '../../../lib/api';
import { ALLOWED_IMAGE_TYPES, MAX_UPLOAD_BYTES, magicMatchesExt } from '../../../lib/uploadTypes';
import { logoExtension } from '../../../(dashboard)/cards/catalogRules';

const BUCKET = 'card-logos';
const CACHE_SECONDS = '31536000';
const AUDIT_WARNING = 'The logo was uploaded, but the upload could not be written to the audit log.';

export async function POST(req: NextRequest) {
  const guard = await requireAdmin('catalog.write');
  if (!guard.ok) return guard.response;

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return fail('VALIDATION_ERROR', 'Send the logo as a file upload.');
  }
  const file = form.get('file');
  if (!file || typeof file === 'string') return fail('VALIDATION_ERROR', 'No file provided');

  const ext = logoExtension(file.name);
  const contentType = ALLOWED_IMAGE_TYPES[ext];
  if (!contentType) {
    return fail('VALIDATION_ERROR', `File type not allowed. Accepted: ${Object.keys(ALLOWED_IMAGE_TYPES).join(', ')}`);
  }
  if (file.size > MAX_UPLOAD_BYTES) return fail('VALIDATION_ERROR', 'File too large (max 5 MB)');

  const fileName = `${crypto.randomUUID()}.${ext}`;
  const buffer = Buffer.from(await file.arrayBuffer());
  if (!magicMatchesExt(buffer, ext)) {
    return fail('VALIDATION_ERROR', 'File content does not match its extension');
  }

  const audit: AuditInput = {
    admin: guard.admin,
    action: 'UPLOAD_CARD_LOGO',
    entity: 'card_logos',
    entity_id: fileName,
    sensitivity: 'normal',
    after: { path: fileName, content_type: contentType, size: file.size },
  };

  const { error } = await supabaseAdmin.storage
    .from(BUCKET)
    .upload(fileName, buffer, { contentType, cacheControl: CACHE_SECONDS, upsert: false });
  if (error) {
    console.error('card logo upload:', error.message);
    await writeAudit({ ...audit, result: 'failure', error: error.message });
    return fail('INTERNAL_ERROR', 'The logo could not be stored. Try again.');
  }

  const { data: { publicUrl } } = supabaseAdmin.storage.from(BUCKET).getPublicUrl(fileName);

  const recorded = await writeAudit({
    ...audit,
    after: { path: fileName, content_type: contentType, size: file.size, url: publicUrl },
    result: 'success',
  });
  return ok({
    url: publicUrl,
    ...(recorded.ok ? { audit_recorded: true } : { audit_recorded: false, warning: AUDIT_WARNING }),
  });
}
