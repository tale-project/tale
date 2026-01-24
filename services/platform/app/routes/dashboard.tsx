import { Outlet, createFileRoute, redirect } from '@tanstack/react-router';
import { authClient } from '@/lib/auth-client';

// Cache session to avoid network requests on every navigation
let cachedSession: { user: unknown; timestamp: number } | null = null;
const SESSION_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

async function getSessionWithCache() {
  const now = Date.now();

  // Return cached session if valid
  if (cachedSession && now - cachedSession.timestamp < SESSION_CACHE_TTL) {
    return cachedSession.user;
  }

  // Fetch fresh session
  const session = await authClient.getSession();
  if (session?.data?.user) {
    cachedSession = { user: session.data.user, timestamp: now };
    return session.data.user;
  }

  cachedSession = null;
  return null;
}

export const Route = createFileRoute('/dashboard')({
  beforeLoad: async () => {
    const user = await getSessionWithCache();
    if (!user) {
      throw redirect({ to: '/log-in' });
    }
    return { user };
  },
  component: DashboardRedirect,
});

function DashboardRedirect() {
  return <Outlet />;
}
