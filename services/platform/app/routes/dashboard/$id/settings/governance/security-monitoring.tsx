import { createFileRoute } from '@tanstack/react-router';

import { LoginPolicyEditor } from '@/app/features/settings/governance/components/login-policy-editor';
import { PasswordPolicyEditor } from '@/app/features/settings/governance/components/password-policy-editor';
import { TwoFactorPolicyEditor } from '@/app/features/settings/governance/components/two-factor-policy-editor';
import { ensureGovernancePolicies } from '@/app/lib/loader-preload';

export const Route = createFileRoute(
  '/dashboard/$id/settings/governance/security-monitoring',
)({
  // Warm the page's policies so editors paint real content on first render.
  loader: ({ context, params }) =>
    ensureGovernancePolicies(context, params.id, [
      'login_policy',
      'password_policy',
      'two_factor_policy',
    ]).catch((error: unknown) => {
      console.warn('Failed to preload security-monitoring policies', error);
    }),
  component: SecurityMonitoringRoute,
});

function SecurityMonitoringRoute() {
  const { id: organizationId } = Route.useParams();

  // Eager-imported so all three reveal together under one coordinated
  // skeletonization (a lazy chunk's inner Suspense would pop one in alone).
  return (
    <div className="divide-border flex flex-col divide-y">
      <div className="pb-7">
        <LoginPolicyEditor organizationId={organizationId} />
      </div>
      <div className="py-7">
        <PasswordPolicyEditor organizationId={organizationId} />
      </div>
      <div className="pt-7">
        <TwoFactorPolicyEditor organizationId={organizationId} />
      </div>
    </div>
  );
}
