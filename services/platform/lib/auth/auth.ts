import { convexBetterAuthReactStart } from '@convex-dev/better-auth/react-start';
import { fetchQuery } from '@/lib/convex-server';
import { api } from '@/convex/_generated/api';

const siteUrl = process.env.SITE_URL || 'http://localhost:3000';

const auth = convexBetterAuthReactStart({
  convexUrl: process.env.NEXT_PUBLIC_CONVEX_URL!,
  convexSiteUrl: `${siteUrl}/http_api`,
});

export async function getAuthToken(): Promise<string | undefined> {
  try {
    return await auth.getToken();
  } catch (error) {
    console.warn('getAuthToken failed:', error);
    return undefined;
  }
}

