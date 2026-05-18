import { NextResponse } from 'next/server';
import { verifyAdminFromRequest } from '../../lib/jwt';
import { getDashboardData } from '../../lib/dashboard';

export async function GET() {
  const admin = await verifyAdminFromRequest();
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  return NextResponse.json(await getDashboardData(admin));
}
