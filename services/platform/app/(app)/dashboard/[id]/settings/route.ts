import { redirect } from 'next/navigation';
import { NextRequest } from 'next/server';

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  redirect(`/dashboard/${id}/settings/organization`);
}
