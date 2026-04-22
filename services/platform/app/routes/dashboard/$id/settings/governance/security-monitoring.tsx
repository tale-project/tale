import { createFileRoute } from '@tanstack/react-router';

import { lazyComponent } from '@/lib/utils/lazy-component';

const LoginPolicyEditor = lazyComponent(() =>
  import('@/app/features/settings/governance/components/login-policy-editor').then(
    (m) => ({ default: m.LoginPolicyEditor }),
  ),
);

const PasswordPolicyEditor = lazyComponent(() =>
  import('@/app/features/settings/governance/components/password-policy-editor').then(
    (m) => ({ default: m.PasswordPolicyEditor }),
  ),
);

const TwoFactorPolicyEditor = lazyComponent(() =>
  import('@/app/features/settings/governance/components/two-factor-policy-editor').then(
    (m) => ({ default: m.TwoFactorPolicyEditor }),
  ),
);

export const Route = createFileRoute(
  '/dashboard/$id/settings/governance/security-monitoring',
)({
  component: SecurityMonitoringRoute,
});

function SecurityMonitoringRoute() {
  const { id: organizationId } = Route.useParams();

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
