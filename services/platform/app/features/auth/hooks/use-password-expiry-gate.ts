import { useLocation, useNavigate, useParams } from '@tanstack/react-router';
import { useEffect } from 'react';

import { useConvexQuery } from '@/app/hooks/use-convex-query';
import { api } from '@/convex/_generated/api';

const FORCED_CHANGE_PATH = 'forced-change-password';

/**
 * Watches the current user's password expiry status and redirects to the
 * forced-change-password route when the credential has expired.
 *
 * Runs as a reactive Convex subscription inside the dashboard layout so
 * policy changes and post-rotation status updates propagate without a
 * full reload and without per-navigation fetches.
 */
export function usePasswordExpiryGate(organizationId: string): void {
  const navigate = useNavigate();
  const location = useLocation();
  const params = useParams({ strict: false });
  const { data } = useConvexQuery(
    api.users.queries.getPasswordExpiryStatus,
    organizationId ? {} : 'skip',
  );

  useEffect(() => {
    if (!data || !data.expired) return;
    if (location.pathname.endsWith(FORCED_CHANGE_PATH)) return;
    const id = (params as { id?: string }).id ?? organizationId;
    void navigate({
      to: '/dashboard/$id/forced-change-password',
      params: { id },
      replace: true,
    });
  }, [data, location.pathname, navigate, organizationId, params]);
}
