import { requireAdmin } from '../../../lib/guard';
import { fail, ok } from '../../../lib/api';
import { refuse } from '../../../lib/rateSync';
import { readProviderRegistry } from '../../../lib/rateService';
import { providerJson, serviceRefusal, webOnlyText } from '../../../(dashboard)/automatic-rates/rules';

export async function GET() {
  const guard = await requireAdmin('rates.read');
  if (!guard.ok) return guard.response;
  if (guard.admin.session.client !== 'web') return fail('PERMISSION_DENIED', webOnlyText('check'));

  const registry = await readProviderRegistry('automatic rates providers');
  if (!registry.ok) return refuse(serviceRefusal(registry.failure, 'check'));
  return ok({ providers: providerJson(registry.providers) });
}
