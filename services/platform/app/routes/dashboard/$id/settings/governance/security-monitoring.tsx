import { createFileRoute } from '@tanstack/react-router';

import { EditorGroup } from '@/app/components/ui/editor';
import { SettingsPage } from '@/app/features/settings/components/settings-page';
import { LoginPolicyEditor } from '@/app/features/settings/governance/components/login-policy-editor';
import { PasswordPolicyEditor } from '@/app/features/settings/governance/components/password-policy-editor';
import { SessionIdleTimeoutEditor } from '@/app/features/settings/governance/components/session-idle-timeout-editor';
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
      'session_idle_timeout',
    ]).catch((error: unknown) => {
      console.warn('Failed to preload security-monitoring policies', error);
    }),
  component: SecurityMonitoringRoute,
});

function SecurityMonitoringRoute() {
  const { id: organizationId } = Route.useParams();

  // Wrapped in SettingsPage so this page carries the same section rhythm as
  // its sibling governance pages. The editors are eager-imported so they
  // reveal together under one coordinated skeletonization and are spaced by
  // SettingsPage's layout.
  return (
    <SettingsPage>
      <EditorGroup>
        <LoginPolicyEditor organizationId={organizationId} />
        <PasswordPolicyEditor organizationId={organizationId} />
        <TwoFactorPolicyEditor organizationId={organizationId} />
        <SessionIdleTimeoutEditor organizationId={organizationId} />
      </EditorGroup>
    </SettingsPage>
  );
}
