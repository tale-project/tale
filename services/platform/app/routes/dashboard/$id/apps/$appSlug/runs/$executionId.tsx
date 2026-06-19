import { VStack } from '@tale/ui/layout';
import { createFileRoute, Link } from '@tanstack/react-router';
import { ArrowLeft } from 'lucide-react';

import { OperatorShell } from '@/app/features/operator/components/operator-shell';
import { useT } from '@/lib/i18n/client';

export const Route = createFileRoute(
  '/dashboard/$id/apps/$appSlug/runs/$executionId',
)({
  component: AppRunDetail,
});

/**
 * In-app run detail: the reusable operator view (stage timeline + per-step
 * render-kind panels) embedded inside the app shell, reached from the app's
 * Runs list. Keeps "watch a run" inside the app instead of ejecting to the
 * global automations operator route.
 */
function AppRunDetail() {
  const { id: organizationId, appSlug, executionId } = Route.useParams();
  const { t } = useT('apps');
  return (
    <VStack gap={4}>
      <Link
        to="/dashboard/$id/apps/$appSlug"
        params={{ id: organizationId, appSlug }}
        className="text-muted-foreground hover:text-foreground inline-flex w-fit items-center gap-1 text-sm"
      >
        <ArrowLeft className="size-4" />
        {t('runs.backToApp', { defaultValue: 'Back to app' })}
      </Link>
      <OperatorShell
        organizationId={organizationId}
        executionId={executionId}
      />
    </VStack>
  );
}
