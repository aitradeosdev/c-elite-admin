import type { NextRequest } from 'next/server';
import { supabaseAdmin } from '../../../lib/supabase';
import { requireAdmin, requireAdminAll } from '../../../lib/guard';
import { writeAudit } from '../../../lib/audit';
import { ok, fail, isUuid } from '../../../lib/api';
import {
  buildCardShareText, isShareChannel, permissionForChannel, sharedFieldLabels, shareSubject,
  type ShareableSubmission,
} from '../../../lib/cardShare';

const SIGNED_URL_SECONDS = 300;

interface SubmissionRow {
  id: string;
  user_id: string | null;
  card_id: string | null;
  card_type_id: string | null;
  amount_foreign: number | string | null;
  submitted_fields: Record<string, unknown> | null;
  card_images: string[] | null;
  cards: { name: string | null } | null;
  card_types: { name: string | null; country_code: string | null } | null;
}

async function signImages(paths: string[] | null): Promise<string[]> {
  if (!paths || paths.length === 0) return [];
  const signed = await Promise.all(
    paths.map((path) => supabaseAdmin.storage.from('card-images').createSignedUrl(path, SIGNED_URL_SECONDS)),
  );
  return signed.map((r) => r.data?.signedUrl).filter((url): url is string => Boolean(url));
}

export async function GET() {
  const guard = await requireAdmin('cards.read');
  if (!guard.ok) return guard.response;
  return ok({
    share: guard.admin.can('sensitive_data.share'),
    download: guard.admin.can('sensitive_data.download'),
  });
}

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as { submission_id?: unknown; channel?: unknown };
  const submissionId = body.submission_id;
  const channel = body.channel;

  if (!isUuid(submissionId)) return fail('VALIDATION_ERROR', 'A valid submission id is required.');
  if (!isShareChannel(channel)) return fail('VALIDATION_ERROR', 'Unknown share channel.');

  const guard = await requireAdminAll(['cards.read', permissionForChannel(channel)]);
  if (!guard.ok) return guard.response;
  const { admin } = guard;

  const { data, error } = await supabaseAdmin
    .from('card_submissions')
    .select(`
      id, user_id, card_id, card_type_id, amount_foreign, submitted_fields, card_images,
      cards(name),
      card_types(name, country_code)
    `)
    .eq('id', submissionId)
    .maybeSingle<SubmissionRow>();

  if (error) return fail('INTERNAL_ERROR', 'The submission could not be loaded.');
  if (!data) return fail('RESOURCE_NOT_FOUND', 'Submission not found.');

  const countryCode = data.card_types?.country_code ?? null;
  const [labelsRes, countryRes] = await Promise.all([
    data.card_type_id
      ? supabaseAdmin.from('card_type_fields').select('id, label').eq('card_type_id', data.card_type_id)
      : Promise.resolve({ data: [] as { id: string; label: string }[] }),
    data.card_id && countryCode
      ? supabaseAdmin
          .from('card_countries')
          .select('country_name')
          .eq('card_id', data.card_id)
          .eq('country_code', countryCode)
          .maybeSingle<{ country_name: string | null }>()
      : Promise.resolve({ data: null }),
  ]);

  const fieldLabels = Object.fromEntries(
    ((labelsRes.data || []) as { id: string; label: string }[]).map((f) => [f.id, f.label]),
  );

  const shareable: ShareableSubmission = {
    cardName: data.cards?.name ?? null,
    countryName: countryRes.data?.country_name ?? null,
    countryCode,
    amountForeign: data.amount_foreign,
    submittedFields: data.submitted_fields,
    fieldLabels,
  };

  const wantsImages = channel === 'native' || channel === 'download';
  const images = wantsImages ? await signImages(data.card_images) : [];

  const audit = await writeAudit({
    admin,
    action: channel === 'download' ? 'DOWNLOAD_CARD_IMAGES' : 'SHARE_CARD_SUBMISSION',
    entity: 'card_submissions',
    entity_id: data.id,
    user_id: data.user_id,
    after: {
      channel,
      image_count: images.length,
      fields_included: channel === 'download' ? [] : sharedFieldLabels(shareable),
    },
    result: 'success',
    sensitivity: 'sensitive',
  });

  if (!audit.ok) {
    return fail(
      'AUDIT_FAILED',
      'Sharing is blocked because it could not be recorded in the audit log. Nothing was shared. Try again.',
    );
  }

  return ok({
    channel,
    text: channel === 'download' ? '' : buildCardShareText(shareable),
    subject: shareSubject(shareable.cardName),
    title: shareable.cardName || 'Card submission',
    images,
  });
}
