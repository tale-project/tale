import { redirect } from 'next/navigation';
import { NextRequest } from 'next/server';
import { getAuthToken } from '@/lib/auth/auth-server';
import { fetchQuery } from '@/lib/convex-next-server';
import { api } from '@/convex/_generated/api';

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const token = await getAuthToken();

  if (!token) {
    redirect('/log-in');
  }

  let isAdmin = false;

  try {
    const memberContext = await fetchQuery(
      api.member.getCurrentMemberContext,
      { organizationId: id },
      { token },
    );
    isAdmin = memberContext?.isAdmin ?? false;
  } catch {
    // If member context fetch fails, default to account settings
  }

  if (isAdmin) {
    redirect(`/dashboard/${id}/settings/organization`);
  }

  redirect(`/dashboard/${id}/settings/account`);
}
