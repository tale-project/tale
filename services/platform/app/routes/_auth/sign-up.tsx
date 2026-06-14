import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useEffect } from 'react';

import { useHasAnyUsers } from '@/app/features/auth/hooks/queries';
import { seo } from '@/lib/utils/seo';

// Account creation now lives inside the first-run setup wizard (`/setup`),
// which walks language/theme → owner account → workspace → OpenRouter. This
// route is kept only so existing links/bookmarks resolve: it forwards to
// `/setup` on a fresh install, or to `/log-in` once any user exists (Tale is
// offline-first — there is no self-service registration beyond the owner).
export const Route = createFileRoute('/_auth/sign-up')({
  head: () => ({
    meta: seo('signup'),
  }),
  component: SignUpPage,
});

function SignUpPage() {
  const navigate = useNavigate();
  const { data: hasUsers, isLoading } = useHasAnyUsers();

  useEffect(() => {
    if (isLoading) return;
    void navigate({ to: hasUsers === true ? '/log-in' : '/setup' });
  }, [hasUsers, isLoading, navigate]);

  return null;
}
