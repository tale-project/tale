import { redirect } from 'next/navigation';
import { NextRequest } from 'next/server';

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: businessId } = await params;

  redirect(`/dashboard/${businessId}/chat`);
}
