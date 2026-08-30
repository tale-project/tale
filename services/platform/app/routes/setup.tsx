import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useEffect, useState } from 'react';

import { useHasAnyUsers } from '@/app/features/auth/hooks/queries';
import { OnboardingWizard } from '@/app/features/organization/components/onboarding/onboarding-wizard';
import { useAuth } from '@/app/hooks/use-session-user';
import { seo } from '@/lib/utils/seo';

/**
 * First-run setup. Lives at the root (not under `_auth`, not under
 * `/dashboard`) on purpose: the wizard spans the unauthenticated →
 * authenticated boundary — its account step signs the very first user in —
 * and neither gate would let that single component run end-to-end. `_auth`
 * bounces authenticated users to `/dashboard`; `/dashboard` bounces
 * unauthenticated ones to `/log-in`.
 *
 * Reachability is guarded in the component (mirroring `_auth/sign-up`): once
 * the wizard has started we never redirect, so account creation flipping
 * `hasUsers`/auth state mid-flow can't bounce the user out.
 */
export const Route = createFileRoute('/setup')({
  head: () => ({ meta: seo('signup') }),
  component: SetupPage,
});

function SetupPage() {
  const navigate = useNavigate();
  const { data: hasUsers, isLoading: usersLoading } = useHasAnyUsers();
  const { isAuthenticated, isLoading: authLoading } = useAuth();
  const [started, setStarted] = useState(false);

  useEffect(() => {
    if (started) return;
    if (authLoading || usersLoading) return;

    // Already signed in → setup is done for this install; send them home.
    if (isAuthenticated) {
      void navigate({ to: '/dashboard' });
      return;
    }
    // Users exist but nobody's signed in → only an admin can add more users,
    // via Settings; this page is owner-only first-run.
    if (hasUsers === true) {
      void navigate({ to: '/log-in' });
      return;
    }
    // No users, no session → genuine first run. Lock the wizard in.
    setStarted(true);
  }, [started, authLoading, usersLoading, isAuthenticated, hasUsers, navigate]);

  if (!started) return null;

  return <OnboardingWizard mode="first-run" />;
}
