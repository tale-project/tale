import { convexBetterAuthReactStart } from '@convex-dev/better-auth/react-start';

import { getEnv } from '@/lib/env';

const siteUrl = getEnv('SITE_URL');

export const {
  handler,
  getToken,
  fetchAuthQuery,
  fetchAuthMutation,
  fetchAuthAction,
} = convexBetterAuthReactStart({
  convexUrl: `${siteUrl}/ws_api`,
  convexSiteUrl: `${siteUrl}/http_api`,
});

export async function getAuthToken(): Promise<string | undefined> {
  try {
    return await getToken();
  } catch (error) {
    console.warn('getAuthToken failed:', error);
    return undefined;
  }
}
