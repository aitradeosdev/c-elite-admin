export async function bustPromoCache(): Promise<void> {
  const url = `${process.env.SUPABASE_URL}/functions/v1/get-active-promos`;
  const secret = process.env.ADMIN_FUNCTION_SECRET || '';
  if (!secret) return;
  try {
    await fetch(url, {
      method: 'POST',
      headers: { 'x-admin-secret': secret },
    });
  } catch {}
}
