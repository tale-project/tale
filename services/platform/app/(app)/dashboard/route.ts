import { api } from '@/convex/_generated/api';
import { getCurrentUser, getAuthToken } from '@/lib/auth/auth-server';
import { fetchQuery } from 'convex/nextjs';
import { redirect } from 'next/navigation';
import type { NextRequest } from 'next/server';
import { isTrustedHeadersEnabled } from '@/lib/auth/trusted-headers';

export async function GET(request: NextRequest) {
  const usingTrustedHeaders = isTrustedHeadersEnabled();
  const retryParam = 'trustedHeadersRetry';
  const hasRetry = request.nextUrl.searchParams.get(retryParam) === '1';

  const user = await getCurrentUser();
  if (!user) {
    if (usingTrustedHeaders && !hasRetry) {
      // Avoid absolute URLs here; using a relative redirect prevents leaking
      // internal hosts like 0.0.0.0 and keeps the browser origin (localhost).
      redirect(`/dashboard?${retryParam}=1`);
    }
    redirect('/log-in');
  }

  const token = await getAuthToken();
  if (!token) {
    if (usingTrustedHeaders && !hasRetry) {
      redirect(`/dashboard?${retryParam}=1`);
    }
    redirect('/log-in');
  }
  const organizationId = await fetchQuery(
    api.organizations.currentOrganization,
    {},
    { token },
  );
  if (!organizationId) {
    redirect('/dashboard/create-organization');
  }
  redirect(`/dashboard/${organizationId}`);
}
