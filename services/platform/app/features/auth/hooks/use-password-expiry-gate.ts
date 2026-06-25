import { useLocation, useNavigate, useParams } from '@tanstack/react-router';
import { useEffect } from 'react';

import { usePasswordExpiry } from '@/app/context/account-bootstrap-context';

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
  // Reads the shared dashboard bootstrap (password-expiry is org-independent),
  // so the gate no longer fires its own per-navigation subscription.
  const data = usePasswordExpiry();

  useEffect(() => {
    if (!data || !data.expired) return;
    // The route is `/forced-change-password/$id`, so the pathname ends with the
    // id, never the literal segment — match by inclusion so the gate actually
    // short-circuits on that page instead of re-navigating to it (#2085[06]).
    if (location.pathname.includes(`/${FORCED_CHANGE_PATH}`)) return;
    const id = (params as { id?: string }).id ?? organizationId;
    void navigate({
      to: '/forced-change-password/$id',
      params: { id },
      replace: true,
    });
  }, [data, location.pathname, navigate, organizationId, params]);
}
